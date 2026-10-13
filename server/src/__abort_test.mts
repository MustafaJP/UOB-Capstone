import "dotenv/config";
const { getModel } = await import("/Users/mustafa/NC-Documents/Work/UOB/Ngee Ann Polytechnic/UOB Capstone/agent-orchestrator/server/src/llm.ts");
const { model } = getModel("gemini", false);
const t0 = Date.now();
const timer = setInterval(() => console.log("still waiting", Math.round((Date.now() - t0) / 1000), "s"), 5000);
try {
  const r: any = await model.invoke("Write a 3000-word essay about bank telegraphic transfers.", { signal: AbortSignal.timeout(5000) });
  console.log("finished without abort after", Date.now() - t0, "ms, chars", r.text.length);
} catch (e: any) {
  console.log("threw after", Date.now() - t0, "ms:", e.name, String(e.message).slice(0, 200));
}
clearInterval(timer);
