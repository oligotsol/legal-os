import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

const LFL_FIRM_ID = "00000000-0000-0000-0000-000000000001";
const EMAIL = "oligotsol+lfl-owner@gmail.com";
const PASSWORD = "DemoLogin2026!";
const FULL_NAME = "Oli (Owner)";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing env vars");
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("Creating owner user...\n");

  const { data: newUser, error: userError } =
    await supabase.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: FULL_NAME },
    });

  if (userError) {
    console.error("createUser failed:", userError.message);
    process.exit(1);
  }

  const userId = newUser.user.id;
  console.log(`1. Auth user created: ${EMAIL} (${userId})`);

  const { error: memberError } = await supabase.from("firm_users").upsert(
    {
      firm_id: LFL_FIRM_ID,
      user_id: userId,
      role: "owner",
    },
    { onConflict: "firm_id,user_id" }
  );

  if (memberError) {
    console.error("firm_users upsert failed:", memberError.message);
    process.exit(1);
  }
  console.log("2. Firm membership created: owner of LFL");

  console.log("\nDone.");
  console.log(`\nLogin credentials:`);
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
