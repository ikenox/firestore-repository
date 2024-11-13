export type Prettify<T> = T extends unknown ? { [K in keyof T]: T[K] } : never;
export const prettify = <T>(obj: T): Prettify<T> => obj as Prettify<T>;
