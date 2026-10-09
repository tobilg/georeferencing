import type { Cv } from "../backend.js";
export default function factory(options?: {
  locateFile?: (path: string) => string;
}): Promise<Cv>;
