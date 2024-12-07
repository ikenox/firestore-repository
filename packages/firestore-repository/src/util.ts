export type Prettify<T> = T extends unknown ? { [K in keyof T]: T[K] } : never;
export const prettify = <T>(obj: T): Prettify<T> => obj as Prettify<T>;

export const assertNever = (x: never): never => {
  throw new Error(`This code should be unreached but: ${x}`);
};
