// Only names from the fixed npm preset list reach cmd.exe.
export function npmCommand(name) {
  return ["cmd.exe", "/d", "/c", "npm", "run", name];
}
