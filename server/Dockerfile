FROM node

WORKDIR /usr/src/app

RUN yarn install

EXPOSE 4000

CMD ["npx", "pm2", "start", "server.ts", "--watch", "--no-daemon", "--interpreter=node_modules/.bin/ts-node"]
