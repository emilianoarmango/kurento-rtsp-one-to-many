var ws_uri = parseQs().ws_uri || window.location.origin.replace(/^http/, 'ws') + '/ws';
var ws = null;
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

function wsWatchdog() {
    if (ws.readyState !== 1) {
        toggleSpinner(true);
        if (ws && ws.readyState !== 3)
            ws.close();
        wsConnect();
    }
}

function wsConnect() {
    toggleSpinner(true);
    ws = new WebSocket(ws_uri);
    ws.onopen = viewer;
    ws.onmessage = wsOnMessage;
}

function wsOnMessage(message) {
    console.info('Received message: ' + message.data);
    var parsedMessage = JSON.parse(message.data);
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
}

function onError(error) {
    console.error(error);
    dispose();
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
    if (document.readyState !== 'complete') {
        setTimeout(viewer, 10);
    } else {
        webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly({
            remoteVideo: video,
            onicecandidate: onIceCandidate
        }, function (error) {
            if (error)
                return onError(error);
            this.generateOffer(onOfferViewer);
        });
    }
}

function onOfferViewer(error, offerSdp) {
    if (error)
        return onError(error);
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

function sendMessage(message) {
    var jsonMessage = JSON.stringify(message);
    if (ws && ws.readyState === 1) {
        console.log('Sending message: ' + jsonMessage);
        ws.send(jsonMessage);
    } else {
        console.warn('WS not connected, ignoring message: ' + jsonMessage);
    }
}

function toggleSpinner(state) {
    if (video)
        video.classList.toggle('loading', state);
}

function dispose() {
    if (webRtcPeer) {
        webRtcPeer.dispose();
        webRtcPeer = null;
    }
    if (ws && ws.readyState !== 3)
        ws.close();
}

window.onload = function () {
    video = document.getElementById('video');
    video.addEventListener('dblclick', function (event) {
        event.preventDefault();
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else if (document.webkitFullscreenElement) {
            document.webkitExitFullscreen();
        } else if (document.mozFullscreenElement) {
            document.mozExitFullscreen();
        } else if (document.body.requestFullscreen) {
            document.body.requestFullscreen();
        } else if (document.body.webkitRequestFullScreen) {
            document.body.webkitRequestFullScreen();
        } else if (document.body.mozRequestFullScreen) {
            document.body.mozRequestFullScreen();
        }
    });

    function hideSpinner() {
        toggleSpinner(false);
    }
    video.addEventListener('play', hideSpinner);
    video.addEventListener('playing', hideSpinner);
    video.addEventListener('stalled', dispose);
    video.addEventListener('ended', dispose);
    video.addEventListener('error', dispose);
    video.addEventListener('pause', function () {
        toggleSpinner(true);
        video.play();
    });
};

window.onbeforeunload = function () {
    if (ws && ws.readyState !== 3)
        ws.close();
};

wsConnect();
setInterval(wsWatchdog, 1000);
