let counter = 0;

export function randomId(): string {
  counter = (counter + 1) >>> 0;
  return `${Date.now().toString(36)}_${counter.toString(36)}_${Math.floor(Math.random() * 0xffff).toString(36)}`;
}
