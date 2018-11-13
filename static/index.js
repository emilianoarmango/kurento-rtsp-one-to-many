var ws_uri = parseQs.ws_uri || window.location.origin.replace(/^http/, 'ws') + '/ws';
var ws = new WebSocket(ws_uri);
var video;
var webRtcPeer;

function parseQs() {
    return (function (a) {
        if (a === '') return {};
        var b = {};
        for (var i = 0; i < a.length; ++i) {
            var p = a[i].split('=', 2);
            if (p.length === 1)
                b[p[0]] = '';
            else
                b[p[0]] = decodeURIComponent(p[1].replace(/\+/g, ''));
        }
        return b;
    })(window.location.search.substr(1).split('&'));
}

window.onload = function () {
    video = document.getElementById('video');
    video.addEventListener('dblclick', function () {
        event.preventDefault();
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else if (document.webkitFullscreenElement) {
            document.webkitExitFullscreen();
        } else {
            try {
                this.requestFullscreen();
            } catch (e) {
                this.webkitRequestFullScreen();
            }
        }
    });
    video.addEventListener('pause', video.play);
    viewer();
};

window.onbeforeunload = function () {
    ws.close();
};

ws.onmessage = function (message) {
    var parsedMessage = JSON.parse(message.data);
    console.info('Received message: ' + message.data);

    switch (parsedMessage.id) {
        case 'presenterResponse':
            presenterResponse(parsedMessage);
            break;
        case 'viewerResponse':
            viewerResponse(parsedMessage);
            break;
        case 'stopCommunication':
            dispose();
            break;
        case 'iceCandidate':
            console.log("iceCandidate message");
            webRtcPeer.addIceCandidate(parsedMessage.candidate);
            break;
        default:
            console.error('Unrecognized message', parsedMessage);
    }
};

function onError(error) {
    console.error(error);
}

function presenterResponse(message) {
    if (message.response !== 'accepted') {
        var errorMsg = message.message ? message.message : 'Unknown error';
        console.warn('Call not accepted for the following reason: ' + errorMsg);
        dispose();
    } else {
        webRtcPeer.processAnswer(message.sdpAnswer);
    }
}

function viewerResponse(message) {
    if (message.response !== 'accepted') {
        var errorMsg = message.message ? message.message : 'Unknown error';
        console.warn('Call not accepted for the following reason: ' + errorMsg);
        dispose();
    } else {
        webRtcPeer.processAnswer(message.sdpAnswer);
    }
}

function viewer() {
    if (!webRtcPeer) {
        var options = {
            remoteVideo: video,
            onicecandidate: onIceCandidate
        };

        webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options, function (error) {
            if (error) return onError(error);
            this.generateOffer(onOfferViewer);
        });
    }
}

function onOfferViewer(error, offerSdp) {
    if (error) return onError(error);

    var message = {
        id: 'viewer',
        sdpOffer: offerSdp
    };
    sendMessage(message);
}

function onIceCandidate(candidate) {
    console.log('Local candidate' + JSON.stringify(candidate));

    var message = {
        id: 'onIceCandidate',
        candidate: candidate
    };
    sendMessage(message);
}

function dispose() {
    if (webRtcPeer) {
        webRtcPeer.dispose();
        webRtcPeer = null;
    }
    hideSpinner(video);
}

function sendMessage(message) {
    var jsonMessage = JSON.stringify(message);
    console.log('Senging message: ' + jsonMessage);
    ws.send(jsonMessage);
}

function hideSpinner() {
    for (var i = 0; i < arguments.length; i++) {
        arguments[i].src = '';
        arguments[i].poster = '';
        arguments[i].style.background = '';
    }
}
