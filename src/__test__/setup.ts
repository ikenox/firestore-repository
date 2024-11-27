const setUp = async (): Promise<void> => {
  const envVars = {
    // biome-ignore lint/style/useNamingConvention: <explanation>
    FIRESTORE_EMULATOR_HOST: 'localhost:60001',
    // biome-ignore lint/style/useNamingConvention: <explanation>
    TEST_PROJECT: 'ikenox-sunrise',
    // biome-ignore lint/style/useNamingConvention: <explanation>
    TEST_DB: 'test-db',
  } as const;

  const res = await fetch(
    `http://${envVars.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${envVars.TEST_PROJECT}/databases/${envVars.TEST_DB}/documents`,
    { method: 'delete' },
  );
  if (!res.ok) {
    throw new Error(`failed to request to firestore emulator: ${res.status} ${await res.text()}`);
  }

  for (const [k, v] of Object.entries(envVars)) {
    process.env[k] = v;
  }
};

// biome-ignore lint/style/noDefaultExport: <explanation>
export default setUp;
