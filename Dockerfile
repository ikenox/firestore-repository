FROM public.ecr.aws/docker/library/node:lts-alpine
RUN apk add --no-cache openjdk21-jre-headless curl
RUN npm install -g firebase-tools

# download emulators
RUN mkdir -p /root/.cache/firebase/emulators
WORKDIR /root/.cache/firebase/emulators
ENV FIREBASE_UI_VERSION=1.14.0
RUN curl -sSL https://storage.googleapis.com/firebase-preview-drop/emulator/ui-v${FIREBASE_UI_VERSION}.zip | unzip -d ui-v${FIREBASE_UI_VERSION} -
RUN curl -O https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.19.8.jar
WORKDIR /

ADD firebase.json .

CMD firebase emulators:start --project dummy-project --import=/data --export-on-exit
