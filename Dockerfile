FROM ubuntu:latest

RUN apt update
RUN apt install -y curl openjdk-17-jdk
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
RUN apt install -y nodejs

RUN npm install -g firebase-tools
CMD firebase emulators:start
