FROM node:8

WORKDIR /opt/kurento-rtsp-one-to-many
COPY . .

RUN npm install

CMD ["npm", "start"]
