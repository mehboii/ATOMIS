function greet(name: string): string {
  if (!(name.length > 0)) { return "anonymous" }
  return `hello ${name}`
}
let msg: string = greet("atomis")
console.log(msg)
//# sourceMappingURL=hello.ts.ato.map
