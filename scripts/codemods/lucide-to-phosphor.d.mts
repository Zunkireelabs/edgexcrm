export function transformSource(
  fileName: string,
  text: string,
): {
  text: string;
  changed: boolean;
  info: { aliases: string[]; unmapped: string[]; renames: [string, string][]; props: string[]; manual: string[] };
};
