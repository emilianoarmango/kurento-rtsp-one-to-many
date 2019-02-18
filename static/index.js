var ws_uri = parseQs().ws_uri || window.location.origin.replace(/^http/, 'ws') + '/ws';
var ws = null;
var video = null;
var webRtcPeer = null;
var videoWatchdogPrevTime = null;
var videoWatchdogInterval = null;
var playing = false;

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
    if (ws.readyState !== WebSocket.OPEN) {
        console.warn('wsWatchdog: reconnecting', ws.readyState);
        playing = false;
        toggleSpinner(true);
        if (ws && ws.readyState !== WebSocket.CLOSED)
            ws.close();
        wsConnect();
    }
}

function wsConnect() {
    console.debug('wsConnect', ws_uri);
    playing = false;
    toggleSpinner(true);
    ws = new WebSocket(ws_uri);
    ws.onopen = viewer;
    ws.onmessage = wsOnMessage;
}

function videoWatchdog() {
    if (video && video.currentTime <= videoWatchdogPrevTime) {
        console.warn('videoWatchdog: stalled', video.currentTime, videoWatchdogPrevTime);
        if (videoWatchdogInterval !== null)
            clearInterval(videoWatchdogInterval);
        videoWatchdogInterval = null;
        videoWatchdogPrevTime = null;
        dispose();
    } else {
        videoWatchdogPrevTime = video.currentTime;
    }
}

function wsOnMessage(message) {
    console.debug('wsOnMessage', message.data);
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
            console.debug('iceCandidate message');
            webRtcPeer.addIceCandidate(parsedMessage.candidate);
            break;
        default:
            console.warn('unrecognized message', parsedMessage);
    }
}

function onError(error) {
    console.error('onError', error);
    dispose();
}

function presenterResponse(message) {
    if (message.response !== 'accepted') {
        var errorMsg = message.message ? message.message : 'Unknown error';
        console.warn('presenterResponse !accepted:', errorMsg);
        dispose();
    } else {
        webRtcPeer.processAnswer(message.sdpAnswer);
    }
}

function viewerResponse(message) {
    if (message.response !== 'accepted') {
        var errorMsg = message.message ? message.message : 'Unknown error';
        console.warn('viewerResponse !accepted:', errorMsg);
        dispose();
    } else {
        webRtcPeer.processAnswer(message.sdpAnswer);
    }
}

function viewer() {
    if (videoWatchdogInterval !== null)
        clearInterval(videoWatchdogInterval);
    videoWatchdogInterval = null;
    videoWatchdogPrevTime = null;
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
    console.debug('onIceCandidate', JSON.stringify(candidate));
    var message = {
        id: 'onIceCandidate',
        candidate: candidate
    };
    sendMessage(message);
}

function sendMessage(message) {
    var jsonMessage = JSON.stringify(message);
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.debug('sendMessage', jsonMessage);
        ws.send(jsonMessage);
    } else {
        console.warn('ws.readyState != WebSocket.OPEN, ignoring message', jsonMessage);
    }
}

function toggleSpinner(state) {
    if (video)
        video.classList.toggle('loading', state);
}

function dispose() {
    console.warn('dispose');
    playing = false;
    toggleSpinner(true);
    if (webRtcPeer) {
        webRtcPeer.dispose();
        webRtcPeer = null;
    }
    if (ws && ws.readyState !== WebSocket.CLOSED)
        ws.close();
}

function toggleFullscreen() {
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
}

function togglePip() {
    if (!playing)
        return;
    if (video.requestPictureInPicture) {
        if (!document.pictureInPictureElement) {
            video.requestPictureInPicture();
        } else {
            document.exitPictureInPicture()
        }
    }
}

function snapshot() {
    if (!playing)
        return;
    var date = new Date();
    var canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    var ctx = canvas.getContext('2d');

    ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    var img_data = canvas.toDataURL('image/jpg');

    var link = document.createElement('a');
    link.download = 'snapshot-' + date.toISOString() + '.jpg';
    link.href = img_data;
    link.click();
}

window.onload = function () {
    function onPlay() {
        playing = true;
        toggleSpinner(false);
        if (videoWatchdogInterval === null)
            videoWatchdogInterval = setInterval(videoWatchdog, 1000);
    }

    video = document.getElementById('video');

    video.addEventListener('click', video.play);
    video.addEventListener('dblclick', toggleFullscreen);

    video.addEventListener('playing', onPlay);
    video.addEventListener('stalled', dispose);
    video.addEventListener('ended', dispose);
    video.addEventListener('error', dispose);
    video.addEventListener('pause', function () {
        playing = false;
        toggleSpinner(true);
        video.play();
    });

    document.addEventListener('keydown', function (event) {
        switch (event.code) {
            case 'KeyF':
                toggleFullscreen();
                break;
            case 'KeyP':
                togglePip();
                break;
            case 'KeyS':
                snapshot();
                break;
        }
    });
};

window.onbeforeunload = function () {
    if (ws && ws.readyState !== WebSocket.CLOSED)
        ws.close();
};

wsConnect();
setInterval(wsWatchdog, 5000);
