export const SUPABASE_URL =
  "https://aklmpwupezvoftehvedw.supabase.co";

export const SUPABASE_PUBLIC_KEY =
  "sb_publishable_b2QQU5s7rpu8KfT89jyntw_hhdmI2Pw";

export async function getSupabaseConfiguration() {
  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
    return {
      error:
        "أكمل إعداد Supabase في ملف supabase-config.js بإضافة Project URL والمفتاح العام (anon/publishable). لا تضع service_role أو أي مفتاح سري في هذا الملف.",
    };
  }

  try {
    const { createClient } = await import(
      "https://esm.sh/@supabase/supabase-js@2.57.0"
    );

    const client = createClient(
      SUPABASE_URL,
      SUPABASE_PUBLIC_KEY
    );

    return { client };
  } catch (error) {
    return {
      error: `تعذر إنشاء اتصال Supabase: ${error.message}`,
    };
  }
}