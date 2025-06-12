import io from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";

const roomName = window.location.pathname.split("/")[2];

const socket = io("http://localhost:5000/mediasoup");

socket.on("connection-success", ({ socketId, existsProducer }) => {
  console.log("hello from socket.io-client");
  console.log(socketId, existsProducer);
  getLocalStream();
});

let device;
let rtpCapabilities;
let producerTransport;
let consumerTransports = [];
let producer;
let consumer;
let isProducer = false;

let params = {
  encoding: [
    {
      rid: "r0",
      maxBitrate: 100000,
      scalabilityMode: "S1T3",
    },
    {
      rid: "r1",
      maxBitrate: 300000,
      scalabilityMode: "S1T3",
    },
    {
      rid: "r2",
      maxBitrate: 900000,
      scalabilityMode: "S1T3",
    },
  ],
  codecOptions: {
    videoGoogleStartBitrate: 1000,
  },
};

const streamSuccess = (stream) => {
  localVideo.srcObject = stream;
  const track = stream.getVideoTracks()[0];
  params = {
    track,
    ...params,
  };

  joinRoom();
};

const joinRoom = () => {
  socket.emit("join-room", { roomName }, (data) => {
    console.log(`Router RTP Capablities... ${data.rtpCapabilities}`);

    rtpCapabilities = data.rtpCapabilities;

    createDevice();
  });
};

const getLocalStream = () => {
  navigator.mediaDevices
    .getUserMedia({
      audio: false,
      video: {
        width: {
          min: 640,
          max: 1920,
        },
        height: {
          min: 400,
          max: 1080,
        },
      },
    })
    .then(streamSuccess)
    .catch((error) => {
      console.log(error.message);
    });
};

// const goConsume = () => {
//   goConnect(false);
// };

// const goConnect = (producerOrConsumer) => {
//   isProducer = producerOrConsumer;
//   device === undefined ? getRtpCapabilities() : goCreateTransport();
// };

// const goCreateTransport = () => {
//   isProducer ? createSendTransport() : createRecvTransport();
// };

const createDevice = async () => {
  try {
    device = new mediasoupClient.Device();

    await device.load({
      routerRtpCapabilities: rtpCapabilities,
    });

    console.log("Device RTP Capababilities", rtpCapabilities);

    createSendTransport();
  } catch (error) {
    console.log(error);

    if (error.name === "UnsupportedError")
      console.warn("browser not supported");
  }
};

const getRtpCapabilities = () => {
  console.log("hello");
  socket.emit("createRoom", (data) => {
    console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`);
    rtpCapabilities = data.rtpCapabilities;

    createDevice();
  });
};

socket.on("new-producer", ({ producerId }) =>
  signalNewConsumerTransport(producerId)
);

const getProducers = () => {
  socket.emit("getProducers", (producerIds) => {
    producerIds.forEach(signalNewConsumerTransport);
  });
};

const createSendTransport = async () => {
  socket.emit("createWebRtcTransport", { consumer: false }, ({ params }) => {
    if (params.error) {
      console.log(params.error);
      return;
    }

    console.log(params);

    producerTransport = device.createSendTransport(params);

    producerTransport.on(
      "connect",
      async ({ dtlsParameters }, callback, errback) => {
        try {
          //Signaling local dtls parameters to the server side transport
          await socket.emit("transport-connect", {
            // transportId: producerTransport.id,
            dtlsParameters: dtlsParameters,
          });

          callback();
        } catch (error) {
          errback(error);
        }
      }
    );

    producerTransport.on("produce", async (parameters, callback, errback) => {
      console.log(parameters);

      try {
        await socket.emit(
          "transport-produce",
          {
            transportId: producerTransport.id,
            kind: parameters.kind,
            rtpParameters: parameters.rtpParameters,
            appData: parameters.appData,
          },
          ({ id, producerExists }) => {
            callback({ id });

            if (producerExists) {
              getProducers();
            }
          }
        );
      } catch (error) {
        errback(error);
      }
    });

    connectSendTransport();
  });
};

const connectSendTransport = async () => {
  producer = await producerTransport.produce(params);

  producer.on("trackended", () => {
    console.log("track ended");
  });

  producer.on("transportclose", () => {
    console.log("transport ended");
  });
};

const signalNewConsumerTransport = async (remoteProducerId) => {
  await socket.emit(
    "createWebRtcTransport",
    { consumer: true },
    ({ params }) => {
      if (params.error) {
        console.log(params.error);
        return;
      }

      console.log(params);

      let consumerTransport;
      try {
        consumerTransport = device.createRecvTransport(params);
      } catch (error) {
        console.log(error);
        return;
      }

      consumerTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errback) => {
          try {
            await socket.emit("transport-recv-connect", {
              // transportId: consumerTransport.id,
              dtlsParameters,
              serverConsumerTransportId: params.id,
            });

            callback();
          } catch (error) {}
        }
      );
      connectRecvTransport(consumerTransport, remoteProducerId, params.id);
    }
  );
};

const connectRecvTransport = async (
  consumerTransport,
  remoteProducerId,
  serverConsumerTransportId
) => {
  await socket.emit(
    "consume",
    {
      rtpCapabilities: device.rtpCapabilities,
      remoteProducerId,
      serverConsumerTransportId,
    },
    async ({ params }) => {
      if (params.error) {
        console.log(params.error);
        return;
      }

      console.log(params);

      const consumer = await consumerTransport.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
      });

      consumerTransports = [
        ...consumerTransports,
        {
          consumerTransport,
          serverConsumerTransportId: params.id,
          producerId: remoteProducerId,
          consumer,
        },
      ];

      const newElem = document.createElement("div");
      newElem.setAttribute("id", `td-${remoteProducerId}`);
      newElem.setAttribute("class", "remoteVideo");
      newElem.innerHTML =
        '<video id="' + remoteProducerId + '" autoplay class="video"></video>';
      videoContainer.appendChild(newElem);

      const { track } = consumer;

      // remoteVideo.srcObject = new MediaStream([track]);

      document.getElementById(remoteProducerId).srcObject = new MediaStream([
        track,
      ]);

      socket.emit("consumer-resume", {
        serverConsumerId: params.serverConsumerId,
      });
    }
  );
};

socket.on("producer-closed", ({ remoteProducerId }) => {
  const producerToClose = consumerTransports.find(
    (transportData) => transportData.producerId === remoteProducerId
  );
  producerToClose.consumerTransport.close();
  producerToClose.consumer.close();

  consumerTransports = consumerTransports.filter(
    (transportData) => transportData.producerId !== remoteProducerId
  );

  videoContainer.removeChild(document.getElementById(`td-${remoteProducerId}`));
});
