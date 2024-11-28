export const randomNumber = () => 1000000 + Math.floor(Math.random() * 1000000);

export const randomString = () => Math.random().toString(36).slice(-16);
