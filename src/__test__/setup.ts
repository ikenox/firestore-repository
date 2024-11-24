const setUp = async (): Promise<void> => {
  const envVars = {
    FIRESTORE_EMULATOR_HOST: 'localhost:60001',
    TEST_PROJECT: 'ikenox-sunrise',
    TEST_DB: 'test-db',
  } as const;

  const res = await fetch(
    `http://${envVars.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${envVars.TEST_PROJECT}/databases/${envVars.TEST_DB}/documents`,
    { method: 'delete' },
  );
  console.log(res.status, await res.text());

  Object.entries(envVars).forEach(([k, v]) => {
    process.env[k] = v;
  });
};

export default setUp;
