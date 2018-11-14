var ws_uri = parseQs().ws_uri || window.location.origin.replace(/^http/, 'ws') + '/ws';
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

ws.onopen = viewer;

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
    video.addEventListener('play', hideSpinner);
    video.addEventListener('playing', hideSpinner);
    video.addEventListener('pause', video.play);
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
    if (document.readyState !== 'complete') {
        setTimeout(viewer, 10);
    } else if (!webRtcPeer) {
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
    hideSpinner();
}

function sendMessage(message) {
    var jsonMessage = JSON.stringify(message);
    console.log('Sending message: ' + jsonMessage);
    ws.send(jsonMessage);
}

function hideSpinner() {
    video.classList.remove('loading');
}
