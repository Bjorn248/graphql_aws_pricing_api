FROM node

WORKDIR /usr/src/app

COPY package.json ./
COPY yarn.lock ./

RUN yarn install

COPY server.js .

EXPOSE 4000

CMD ["npm", "start"]
