FROM node:8

USER node
RUN mkdir /home/node/kurento-rtsp-one-to-many
WORKDIR /home/node/kurento-rtsp-one-to-many
COPY --chown=node:node . .

RUN npm install

CMD ["npm", "start"]
