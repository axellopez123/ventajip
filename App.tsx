import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, PermissionsAndroid, Platform, Alert } from 'react-native';
import { RTCPeerConnection, mediaDevices } from 'react-native-webrtc';
import { io, Socket } from 'socket.io-client';

// Configuración de servidores ICE (STUN/TURN)
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { 
    urls: 'turn:your-turn-server.com:3478',
    username: 'username',
    credential: 'password' 
  }
];

type CallStatus = 'idle' | 'calling' | 'in_call' | 'ended';

const App = () => {
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const socket = useRef<Socket | null>(null);
  const localStreamRef = useRef<any>(null);

  // Inicializar conexión
  useEffect(() => {
    if (!userId) return;

    // 1. Configurar Socket.IO
    socket.current = io('https://your-fastapi-server.com', {
      auth: { userId },
      transports: ['websocket']
    });

    // 2. Configurar WebRTC
    setupWebRTC();

    return () => {
      if (socket.current) socket.current.disconnect();
      if (peerConnection.current) peerConnection.current.close();
    };
  }, [userId]);

  const setupWebRTC = async () => {
    try {
      // 1. Crear conexión peer-to-peer
      peerConnection.current = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      // 2. Obtener stream local
      const stream = await mediaDevices.getUserMedia({
        audio: {
          sampleRate: 48000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      
      setLocalStream(stream);
      localStreamRef.current = stream;

      // 3. Añadir tracks al peer connection
      stream.getTracks().forEach(track => {
        peerConnection.current?.addTrack(track, stream);
      });

      // 4. Configurar eventos
      peerConnection.current.onicecandidate = (event) => {
        if (event.candidate && socket.current) {
          socket.current.emit('ice-candidate', {
            candidate: event.candidate,
            targetUserId: 'remote-user-id' // Reemplazar con lógica real
          });
        }
      };

      peerConnection.current.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
      };

      // 5. Configurar eventos del socket
      if (socket.current) {
        socket.current.on('offer', handleOffer);
        socket.current.on('answer', handleAnswer);
        socket.current.on('ice-candidate', handleNewICECandidate);
        socket.current.on('call-ended', endCall);
      }

    } catch (error) {
      console.error('Error setting up WebRTC:', error);
      Alert.alert('Error', 'No se pudo configurar la llamada');
    }
  };

  const startCall = async () => {
    if (!peerConnection.current || !socket.current) return;
    
    try {
      setCallStatus('calling');
      
      // Crear oferta
      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);
      
      // Enviar oferta al otro usuario
      socket.current.emit('offer', {
        offer,
        targetUserId: 'remote-user-id' // Reemplazar con lógica real
      });

    } catch (error) {
      console.error('Error starting call:', error);
      setCallStatus('idle');
    }
  };

  const endCall = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (peerConnection.current) peerConnection.current.close();
    setCallStatus('ended');
    setTimeout(() => setCallStatus('idle'), 2000);
  };

  const handleOffer = async (data: any) => {
    if (!peerConnection.current) return;
    
    await peerConnection.current.setRemoteDescription(data.offer);
    const answer = await peerConnection.current.createAnswer();
    await peerConnection.current.setLocalDescription(answer);
    
    if (socket.current) {
      socket.current.emit('answer', {
        answer,
        targetUserId: data.fromUserId
      });
    }
    
    setCallStatus('in_call');
  };

  const handleAnswer = async (data: any) => {
    if (peerConnection.current) {
      await peerConnection.current.setRemoteDescription(data.answer);
      setCallStatus('in_call');
    }
  };

  const handleNewICECandidate = async (data: any) => {
    if (peerConnection.current && data.candidate) {
      await peerConnection.current.addIceCandidate(data.candidate);
    }
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach(track => (track.enabled = !track.enabled));
      setIsMuted(!isMuted);
    }
  };

  const toggleSpeaker = () => {
    // Implementar lógica de altavoz
    setIsSpeakerOn(!isSpeakerOn);
  };

  if (!userId) {
    return <AuthScreen onLogin={setUserId} />;
  }

  return (
    <View style={styles.container}>
      {callStatus === 'idle' && (
        <View style={styles.idleContainer}>
          <Text style={styles.title}>WebRTC Analyzer</Text>
          <TouchableOpacity style={styles.callButton} onPress={startCall}>
            <Text style={styles.callButtonText}>Iniciar Llamada</Text>
          </TouchableOpacity>
        </View>
      )}

      {(callStatus === 'calling' || callStatus === 'in_call') && (
        <CallScreen 
          localStream={localStream}
          remoteStream={remoteStream}
          isMuted={isMuted}
          isSpeakerOn={isSpeakerOn}
          onEndCall={endCall}
          onToggleMute={toggleMute}
          onToggleSpeaker={toggleSpeaker}
          callStatus={callStatus}
        />
      )}

      {callStatus === 'ended' && (
        <View style={styles.endContainer}>
          <Text style={styles.endText}>Llamada finalizada</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  idleContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 30,
  },
  callButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
  },
  callButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  endContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  endText: {
    fontSize: 22,
    color: '#333',
  },
});

export default App;