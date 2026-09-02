import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    let isAdmin = false;
    let userId = null;

    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        userId = user.id;
        const role = user.app_metadata?.role || user.user_metadata?.role;
        isAdmin = role === "admin";
      }
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const body = req.method !== "GET" ? await req.json() : null;

    // ==================== LIST SURVEYS ====================
    if (action === "list" && req.method === "GET") {
      const { data: surveys, error } = await supabase
        .from("surveys")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Get response counts
      const surveyIds = surveys.map(s => s.id);
      const { data: counts } = await supabase
        .from("survey_responses")
        .select("survey_id")
        .in("survey_id", surveyIds);

      const countMap = {};
      (counts || []).forEach(r => {
        countMap[r.survey_id] = (countMap[r.survey_id] || 0) + 1;
      });

      const result = surveys.map(s => ({
        ...s,
        response_count: countMap[s.id] || 0
      }));

      return new Response(JSON.stringify({ data: result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==================== GET SURVEY BY SLUG (public) ====================
    if (action === "get_by_slug" && req.method === "GET") {
      const slug = url.searchParams.get("slug");
      if (!slug) throw new Error("Slug is required");

      const { data: survey, error } = await supabase
        .from("surveys")
        .select("*")
        .eq("slug", slug)
        .eq("is_active", true)
        .single();

      if (error || !survey) {
        return new Response(JSON.stringify({ error: "Pesquisa não encontrada" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: steps, error: stepsError } = await supabase
        .from("survey_steps")
        .select("*")
        .eq("survey_id", survey.id)
        .order("step_number", { ascending: true });

      if (stepsError) throw stepsError;

      // If step has platform_filter, resolve platform details
      for (const step of steps || []) {
        if (step.step_type === "platforms" && step.platform_filter?.length > 0) {
          // Check if items are UUIDs (individual platforms) or category names
          const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          const hasUuids = step.platform_filter.some(f => uuidPattern.test(String(f)));
          const hasCategories = step.platform_filter.some(f => !uuidPattern.test(String(f)));

          let platforms = [];

          if (hasUuids) {
            const uuidItems = step.platform_filter.filter(f => uuidPattern.test(String(f)));
            const { data: p } = await supabase
              .from("streaming_services")
              .select("id, name, icon_url, color")
              .in("id", uuidItems);
            platforms = [...platforms, ...(p || [])];
          }

          if (hasCategories) {
            const catItems = step.platform_filter.filter(f => !uuidPattern.test(String(f)));
            const { data: p } = await supabase
              .from("streaming_services")
              .select("id, name, icon_url, color")
              .in("category", catItems);
            platforms = [...platforms, ...(p || [])];
          }

          // Deduplicate by id
          const seen = new Set();
          step.platforms = platforms.filter(p => {
            const dup = seen.has(p.id);
            seen.add(p.id);
            return !dup;
          });
        }
      }

      return new Response(JSON.stringify({ data: { ...survey, steps: steps || [] } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==================== GET SURVEY WITH STEPS (admin) ====================
    if (action === "get" && req.method === "GET") {
      if (!isAdmin) throw new Error("Unauthorized");

      const id = url.searchParams.get("id");
      if (!id) throw new Error("ID is required");

      const { data: survey, error } = await supabase
        .from("surveys")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;

      const { data: steps, error: stepsError } = await supabase
        .from("survey_steps")
        .select("*")
        .eq("survey_id", id)
        .order("step_number", { ascending: true });

      if (stepsError) throw stepsError;

      // Resolve platform details for platform steps
      for (const step of steps || []) {
        if (step.step_type === "platforms" && step.platform_filter?.length > 0) {
          // Check if items are UUIDs (individual platforms) or category names
          const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          const hasUuids = step.platform_filter.some(f => uuidPattern.test(String(f)));
          const hasCategories = step.platform_filter.some(f => !uuidPattern.test(String(f)));

          let platforms = [];

          if (hasUuids) {
            const uuidItems = step.platform_filter.filter(f => uuidPattern.test(String(f)));
            const { data: p } = await supabase
              .from("streaming_services")
              .select("id, name, icon_url, color")
              .in("id", uuidItems);
            platforms = [...platforms, ...(p || [])];
          }

          if (hasCategories) {
            const catItems = step.platform_filter.filter(f => !uuidPattern.test(String(f)));
            const { data: p } = await supabase
              .from("streaming_services")
              .select("id, name, icon_url, color")
              .in("category", catItems);
            platforms = [...platforms, ...(p || [])];
          }

          // Deduplicate by id
          const seen = new Set();
          step.platforms = platforms.filter(p => {
            const dup = seen.has(p.id);
            seen.add(p.id);
            return !dup;
          });
        }
      }

      return new Response(JSON.stringify({ data: { ...survey, steps: steps || [] } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==================== CREATE SURVEY ====================
    if (action === "create" && req.method === "POST") {
      if (!isAdmin) throw new Error("Unauthorized");

      const { title, description, slug, is_active, show_in_catalog, steps } = body;

      // Create survey
      const { data: survey, error: surveyError } = await supabase
        .from("surveys")
        .insert({
          title,
          description,
          slug: slug || null,
          is_active: is_active !== false,
          show_in_catalog: show_in_catalog || false,
          created_by: userId,
        })
        .select()
        .single();

      if (surveyError) throw surveyError;

      // Create steps
      if (steps && steps.length > 0) {
        const stepsData = steps.map((step, i) => ({
          survey_id: survey.id,
          step_number: i + 1,
          step_type: step.step_type,
          title: step.title,
          description: step.description || null,
          is_required: step.is_required !== false,
          question_type: step.question_type || null,
          options: step.options || [],
          content: step.content || null,
          image_url: step.image_url || null,
          platform_filter: step.platform_filter || [],
          branch_sim_step: step.branch_sim_step || null,
          branch_nao_step: step.branch_nao_step || null,
        }));

        const { error: stepsError } = await supabase
          .from("survey_steps")
          .insert(stepsData);

        if (stepsError) throw stepsError;
      }

      return new Response(JSON.stringify({ data: survey }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==================== UPDATE SURVEY ====================
    if (action === "update" && req.method === "POST") {
      if (!isAdmin) throw new Error("Unauthorized");

      const { id, title, description, slug, is_active, show_in_catalog, steps } = body;
      if (!id) throw new Error("ID is required");

      // Update survey
      const { error: surveyError } = await supabase
        .from("surveys")
        .update({
          title,
          description,
          slug: slug || null,
          is_active,
          show_in_catalog: show_in_catalog || false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (surveyError) throw surveyError;

      // Delete existing steps and re-insert
      if (steps) {
        await supabase.from("survey_steps").delete().eq("survey_id", id);

        if (steps.length > 0) {
          const stepsData = steps.map((step, i) => ({
            survey_id: id,
            step_number: i + 1,
            step_type: step.step_type,
            title: step.title,
            description: step.description || null,
            is_required: step.is_required !== false,
            question_type: step.question_type || null,
            options: step.options || [],
            content: step.content || null,
            image_url: step.image_url || null,
            platform_filter: step.platform_filter || [],
            branch_sim_step: step.branch_sim_step || null,
            branch_nao_step: step.branch_nao_step || null,
          }));

          const { error: stepsError } = await supabase
            .from("survey_steps")
            .insert(stepsData);

          if (stepsError) throw stepsError;
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==================== DELETE SURVEY ====================
    if (action === "delete" && req.method === "POST") {
      if (!isAdmin) throw new Error("Unauthorized");

      const { id } = body;
      if (!id) throw new Error("ID is required");

      const { error } = await supabase.from("surveys").delete().eq("id", id);
      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==================== SUBMIT RESPONSE (public) ====================
    if (action === "submit" && req.method === "POST") {
      const {
        survey_id,
        respondent_name,
        respondent_email,
        respondent_phone,
        respondent_whatsapp,
        answers,
      } = body;

      if (!survey_id || !respondent_name) {
        throw new Error("survey_id and respondent_name are required");
      }

      // Verify survey exists and is active
      const { data: survey } = await supabase
        .from("surveys")
        .select("id")
        .eq("id", survey_id)
        .eq("is_active", true)
        .single();

      if (!survey) {
        return new Response(JSON.stringify({ error: "Pesquisa não encontrada ou inativa" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: response, error } = await supabase
        .from("survey_responses")
        .insert({
          survey_id,
          respondent_name,
          respondent_email: respondent_email || null,
          respondent_phone: respondent_phone || null,
          respondent_whatsapp: respondent_whatsapp || null,
          answers: answers || {},
          completed_at: new Date().toISOString(),
          ip_address: req.headers.get("x-forwarded-for") || null,
          user_agent: req.headers.get("user-agent") || null,
        })
        .select()
        .single();

      if (error) throw error;

      return new Response(JSON.stringify({ data: response }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==================== GET RESPONSES (admin) ====================
    if (action === "responses" && req.method === "GET") {
      if (!isAdmin) throw new Error("Unauthorized");

      const surveyId = url.searchParams.get("survey_id");
      if (!surveyId) throw new Error("survey_id is required");

      const { data: responses, error } = await supabase
        .from("survey_responses")
        .select("*")
        .eq("survey_id", surveyId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Get survey steps for context
      const { data: steps } = await supabase
        .from("survey_steps")
        .select("*")
        .eq("survey_id", surveyId)
        .order("step_number", { ascending: true });

      return new Response(JSON.stringify({ data: { responses: responses || [], steps: steps || [] } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==================== GET PLATFORMS ====================
    if (action === "platforms" && req.method === "GET") {
      const { data: platforms, error } = await supabase
        .from("streaming_services")
        .select("id, name, icon_url, color")
        .order("name", { ascending: true });

      if (error) throw error;

      return new Response(JSON.stringify({ data: platforms || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==================== ENSURE BRANCH COLUMNS ====================
    if (action === "ensure-columns") {
      const { error } = await supabase.rpc("exec_sql", {
        sql: `
          DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='survey_steps' AND column_name='branch_sim_step') THEN
              ALTER TABLE survey_steps ADD COLUMN branch_sim_step INT;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='survey_steps' AND column_name='branch_nao_step') THEN
              ALTER TABLE survey_steps ADD COLUMN branch_nao_step INT;
            END IF;
          END $$;
        `
      });
      if (error) throw error;
      return new Response(JSON.stringify({ data: { ok: true } }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("manage-survey error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
