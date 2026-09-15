FROM node:22-alpine
WORKDIR /app
COPY package.json server.js index.html app.js style.css data.json ./
# The data lives on a volume so it survives new versions of the image.
RUN mkdir /data && chown node:node /data
VOLUME /data
ENV PORT=3000 DATA_FILE=/data/data.json
USER node
EXPOSE 3000
CMD ["node", "server.js"]
