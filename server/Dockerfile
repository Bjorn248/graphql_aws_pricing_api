FROM node:8.10

WORKDIR /usr/src/app

ADD package.json yarn.lock tsconfig.json ./
RUN yarn install

EXPOSE 4000

CMD ["npx", "pm2", "start", "src/server.ts", "--watch", "--no-daemon", "--interpreter=node_modules/.bin/ts-node", "--restart-delay=30000"]
