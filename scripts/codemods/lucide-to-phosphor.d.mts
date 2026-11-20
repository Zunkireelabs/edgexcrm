export function transformSource(
  fileName: string,
  text: string,
  opts?: { target?: "phosphor" | "local" },
): {
  text: string;
  changed: boolean;
  info: { aliases: string[]; unmapped: string[]; renames: [string, string][]; props: string[]; manual: string[] };
};
