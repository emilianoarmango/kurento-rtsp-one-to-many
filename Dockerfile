FROM node:8

USER node

WORKDIR /home/node/kurento-rtsp-one-to-many
COPY --chown=node:node . .

RUN npm install

CMD ["npm", "start"]
