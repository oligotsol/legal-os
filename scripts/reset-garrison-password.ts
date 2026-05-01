import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });

const USER_ID = "7791870e-e06f-458b-ad02-f0fb104543f6";
const NEW_PASSWORD = "DemoLogin2026!";

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

  const { data, error } = await supabase.auth.admin.updateUserById(USER_ID, {
    password: NEW_PASSWORD,
  });

  if (error) {
    console.error("Failed to reset password:", error.message);
    process.exit(1);
  }

  console.log("Password reset for:", data.user.email);
  console.log("New password:", NEW_PASSWORD);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
