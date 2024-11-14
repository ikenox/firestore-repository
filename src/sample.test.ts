import { GenericContainer } from 'testcontainers';
import { it } from 'vitest';

it('test', async () => {
  const container = await new GenericContainer('').withReuse().start();
});
