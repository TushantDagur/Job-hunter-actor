FROM apify/actor-node:16

COPY package*.json ./
RUN npm install --only=prod

COPY . ./

CMD ["npm", "start"]
