import { GenericContainer } from 'testcontainers';

export default async () => {
  console.info('building firestore emulator docker image...');
  const image = await GenericContainer.fromDockerfile('./firestore-emulator').build(
    'firestar/firestore-emulator:latest',
    { deleteOnExit: false },
  );
  console.info('starting firestore emulator docker container...');
  const container = await image.withExposedPorts(60000, 60001).withReuse().start();

  process.env['FIRESTORE_EMULATOR_HOST'] =
    `${container.getHost()}:${container.getMappedPort(60001)}`;
};
