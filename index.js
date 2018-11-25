#!/usr/bin/env node
const kurento = require('kurento-client');
const fs = require('fs');
const path = require('path');
const wsm = require('ws');
const http = require('http');
const argparse = require('argparse');
const url = require('url');

const defaults = {
    port: 8080,
    kurento: 'ws://localhost:8888/kurento',
    rtsp: 'rtsp://localhost:8554/',
    ws: '/ws'
};

const args = (function () {
    const argParser = new argparse.ArgumentParser();
    argParser.addArgument(['-p', '--port']);
    argParser.addArgument(['-k', '--kurento']);
    argParser.addArgument(['-r', '--rtsp']);
    argParser.addArgument(['-w', '--ws']);
    return argParser.parseArgs()
})();

/*
 * Definition of constants
 */

const PORT = process.env.PORT || args.port || defaults.port;
const KURENTO = process.env.KURENTO || args.kurento || defaults.kurento;
const RTSP = process.env.RTSP || args.rtsp || defaults.rtsp;
const WS = process.env.WS || args.ws || defaults.ws;

const webroot = path.resolve(path.join(__dirname, 'static'));

/*
 * Definition of global variables.
 */

const candidatesQueue = {};
let master = null;
let pipeline = null;
const viewers = {};
let kurentoClient = null;
let playerEndpoint = null;
let positionCheckInterval = null;

function nextUniqueId() {
    let id = 0;
    while (viewers.hasOwnProperty(id.toString()))
        id++;
    return id.toString();
}

/*
 * Server startup
 */

const server = http.createServer(function (req, res) {
    const pathname = url.parse(req.url).pathname;
    if (pathname.indexOf('\0') !== -1) {
        res.writeHead(404);
        res.end();
        return;
    }

    if (pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
    }

    const filename = path.join(webroot, pathname === '/' ? '/index.html' : pathname);

    if (filename.indexOf(webroot) !== 0) {
        res.writeHead(404);
        res.end();
        return;
    }

    const stream = fs.createReadStream(filename);
    stream.on('error', function () {
        res.writeHead(404);
        res.end();
    });
    stream.pipe(res);
}).listen(PORT);

const wsServer = new wsm.Server({
    server: server,
    path: WS
});

// Master Stream hasn't been set
startRTSP(RTSP, function (error) {
    if (error) {
        console.error(`Error: startRTSP: ${error}`);
        process.exit(1);
    } else {
        console.log(`startRTSP: connected`);
    }
});

/*
 * Management of WebSocket messages
 */
wsServer.on('connection', function (ws) {
    const sessionId = nextUniqueId();
    console.log(`Connection received with sessionId ${sessionId}`);
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
        console.log(`pong sessionId ${sessionId}`);
    });
    ws.pingInterval = setInterval(() => {
        console.log(`ping sessionId ${sessionId}`);
        if (ws.isAlive === false) {
            clearInterval(ws.pingInterval);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    }, 30000);

    ws.on('error', function (error) {
        console.log(`Connection ${sessionId} error`);
        console.error(error);
        clearInterval(ws.pingInterval);
        stopClient(sessionId);
    });

    ws.on('close', function () {
        console.log(`Connection ${sessionId} closed`);
        clearInterval(ws.pingInterval);
        stopClient(sessionId);
    });

    ws.on('message', function (_message) {
        console.log(`Connection ${sessionId} received message: ${_message}`);
        let message = {id: null};
        try {
            message = JSON.parse(_message);
        } catch (e) {
        }
        if (!message.hasOwnProperty('id'))
            message.id = null;
        switch (message.id) {
            case 'viewer':
                startViewer(sessionId, message.sdpOffer, ws, function (error, sdpAnswer) {
                    if (error) {
                        return ws.send(JSON.stringify({
                            id: 'viewerResponse',
                            response: 'rejected',
                            message: error
                        }));
                    }

                    ws.send(JSON.stringify({
                        id: 'viewerResponse',
                        response: 'accepted',
                        sdpAnswer: sdpAnswer
                    }));
                });
                break;

            case 'onIceCandidate':
                onIceCandidate(sessionId, message.candidate);
                break;

            default:
                ws.send(JSON.stringify({
                    id: 'error',
                    message: `Invalid message ${_message}`
                }));
                break;
        }
    });
});

/*
 * Definition of functions
 */

// Recover kurentoClient for the first time.
function getKurentoClient(callback) {
    if (kurentoClient !== null) {
        return callback(null, kurentoClient);
    }

    kurento(KURENTO, function (error, _kurentoClient) {
        if (error) {
            console.log(`Could not find media server at address ${KURENTO}`);
            return callback(`Could not find media server at address ${KURENTO}. Exiting with error ${error}`);
        }

        kurentoClient = _kurentoClient;
        callback(null, kurentoClient);
    });
}

function startRTSP(uri, callback) {
    console.log(`startRTSP: connecting to ${uri}`);
    if (master !== null) {
        console.error("Error: Master is not running");
        callback('Master is not running');
        return;
    }

    master = true;

    getKurentoClient(function (error, kurentoClient) {
        if (error) {
            stop(() => process.exit(1));
            console.error(`Error: getKurentoClient: ${error}`);
            return callback(error);
        }

        kurentoClient.create('MediaPipeline', function (error, _pipeline) {
            if (error) {
                console.error(`Error: kurentoClient.create(MediaPipeline): ${error}`);
                return callback(error);
            }

            const params = {
                uri: uri,
                useEncodedMedia: true,
                networkCache: 0
            };

            pipeline = _pipeline;
            createPlayerEndpoint(pipeline, params, callback);
        });
    });
}

function createPlayerEndpoint(pipeline, params, callback) {
    pipeline.create('PlayerEndpoint', params, function (error, _playerEndpoint) {
        if (error) {
            console.error(`Error: pipeline.create(PlayerEndpoint): ${error}`);
            return callback(error);
        }
        playerEndpoint = _playerEndpoint;
        playerEndpoint.on('EndOfStream', () => {
            console.log('RTSP EndOfStream');
            reconnect(pipeline, playerEndpoint, params, callback);
        });
        playerEndpoint.play(function (error) {
            if (error) {
                console.error(`Error: playerEndpoint.play: ${error}`);
                return callback(error);
            }
            for (let id in viewers) {
                if (viewers.hasOwnProperty(id)) {
                    playerEndpoint.connect(viewers[id].webRtcEndpoint, function (error) {
                        console.log('master.webRtcEndpoint.connect');
                        if (error) {
                            stopClient(id);
                            console.error(`Error: master.webRtcEndpoint.connect: ${error}`);
                            return callback(error);
                        }

                        if (master === null) {
                            stopClient(id);
                            console.error('Error: No active sender now. Become sender or try again later');
                            return callback('No active sender now. Become sender or try again later');
                        }
                    });
                }
            }
            if (positionCheckInterval !== null)
                clearInterval(positionCheckInterval);
            positionCheckInterval = setInterval(() => {
                playerEndpoint.getPosition((error, result) => {
                    if (result === 0)
                        reconnect(pipeline, playerEndpoint, params, callback);
                });
            }, 1000);
            callback(null);
        });
    });
}

function reconnect(pipeline, playerEndpoint, params, callback) {
    console.log('RTSP reconnect');
    clearInterval(positionCheckInterval);
    playerEndpoint.stop(() => {
        playerEndpoint.release(() => {
            createPlayerEndpoint(pipeline, params, callback);
        });
    });
}

function startViewer(id, sdp, ws, callback) {
    console.log(`startViewer ${id}`);
    if (master === null || master.webRtcEndpoint === null) {
        console.error('Error: No active streams available. Try again later');
        return callback('No active streams available. Try again later');
    }

    if (viewers[id]) {
        console.error('Error: You are already viewing in this session. Use a different browser to add additional viewers.');
        return callback('You are already viewing in this session. Use a different browser to add additional viewers.')
    }

    pipeline.create('WebRtcEndpoint', function (error, webRtcEndpoint) {
        console.log('pipeline.create(WebRtcEndpoint)');
        if (error) {
            console.error(`Error: pipeline.create(WebRtcEndpoint): ${error}`);
            return callback(error);
        }

        if (master === null) {
            stopClient(id);
            console.error(`Error: No active streams available. Try again later`);
            return callback(`No active streams available. Try again later`);
        }

        const viewer = {
            id: id,
            ws: ws,
            webRtcEndpoint: webRtcEndpoint
        };
        viewers[viewer.id] = viewer;

        master = {webRtcEndpoint: webRtcEndpoint};

        if (candidatesQueue[id]) {
            while (candidatesQueue[id].length) {
                webRtcEndpoint.addIceCandidate(candidatesQueue[id].shift());
            }
        }

        webRtcEndpoint.on('OnIceCandidate', function (event) {
            console.log('webRtcEndpoint OnIceCandidate');
            ws.send(JSON.stringify({
                id: 'iceCandidate',
                candidate: kurento.register.complexTypes.IceCandidate(event.candidate)
            }));
        });

        webRtcEndpoint.processOffer(sdp, function (error, sdpAnswer) {
            console.log('webRtcEndpoint processOffer');
            if (error) {
                stopClient(id);
                console.error(`Error: webRtcEndpoint.processOffer: ${error}`);
                return callback(error);
            }

            if (master === null) {
                stopClient(id);
                console.error('Error: No active streams available. Try again later...');
                return callback('No active streams available. Try again later...');
            }

            playerEndpoint.connect(webRtcEndpoint, function (error) {
                console.log('master.webRtcEndpoint.connect');
                if (error) {
                    stopClient(id);
                    console.error(`Error: master.webRtcEndpoint.connect: ${error}`);
                    return callback(error);
                }

                if (master === null) {
                    stopClient(id);
                    console.error('Error: No active sender now. Become sender or try again later');
                    return callback('No active sender now. Become sender or try again later');
                }

                return callback(null, sdpAnswer);
            });
        });
        webRtcEndpoint.gatherCandidates(function (error) {
            if (error)
                return callback(error);
        });
    });
}

function clearCandidatesQueue(sessionId) {
    if (candidatesQueue[sessionId])
        delete candidatesQueue[sessionId];
}

function onIceCandidate(sessionId, _candidate) {
    const candidate = kurento.register.complexTypes.IceCandidate(_candidate);
    if (viewers[sessionId] && viewers[sessionId].webRtcEndpoint) {
        console.info('Sending viewer candidate');
        viewers[sessionId].webRtcEndpoint.addIceCandidate(candidate);
    } else {
        console.info('Queueing candidate');
        if (!candidatesQueue[sessionId]) {
            candidatesQueue[sessionId] = [];
        }
        candidatesQueue[sessionId].push(candidate);
    }
}

function stopClient(id, callback) {
    console.log(`stopClient: ${id}`);
    if (viewers[id]) {
        let viewer = viewers[id];
        if (viewer.webRtcEndpoint)
            viewer.webRtcEndpoint.release(function (error) {
                if (error) {
                    console.error(`Error: viewer.webRtcEndpoint.release: ${error}`);
                    if (callback)
                        callback(error);
                }
            });
        delete viewers[id];
    }
    clearCandidatesQueue(id);
    if (callback)
        callback(null);
}

function stop(callback) {
    console.log('stopping');
    for (let id in viewers)
        if (viewers.hasOwnProperty(id))
            stopClient(id);
    if (positionCheckInterval !== null)
        clearInterval(positionCheckInterval);
    if (!pipeline) {
        callback(null);
        return;
    }
    pipeline.release(function (error) {
        if (error) {
            console.error(`Error: pipeline.release: ${error}`);
            if (callback)
                callback(error);
        }
        pipeline = null;
        master = null;
        if (callback)
            callback(null);
    });
}

['SIGINT', 'SIGTERM'].forEach(signal => process.on(signal, () => {
    stop(() => process.exit(0));
}));
