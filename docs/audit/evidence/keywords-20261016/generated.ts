function describe(total: number, threshold: number): string {
  if (!(total >= threshold)) { return "Below target" }
  return "Target reached"
}
let userName: string = "Ada"
let first: number = 18
let second: number = 24
let total: number = first + second
let threshold: number = 40
let reached: boolean = total >= threshold
console.log(`Hello, ${userName}!`)
console.log(`Total: ${total}`)
console.log(`Reached target: ${reached}`)
console.log(describe(total, threshold))
//# sourceMappingURL=keyword_verification.ts.ato.map
