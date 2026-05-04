import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const r = await fetch("https://dialpad.com/api/v2/sms", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DIALPAD_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to_numbers: [process.argv[2] ?? "+18475331869"],
      from_number: "+12106107440",
      text: process.argv[3] ?? "[Legal OS] dispatch test 2",
    }),
  });
  console.log("HTTP", r.status);
  const text = await r.text();
  console.log("BODY:", text);
}
main();
