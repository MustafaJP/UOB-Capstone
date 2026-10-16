import type { Severity } from "@/lib/types";

/**
 * deterministic: raised by code (server/src/validate.ts, evidence.ts, graph.ts). The same graph always
 * gives the same result, so the issue is real; fix the diagram or the source.
 * probabilistic: raised by an AI agent (A1–A5). It can differ between runs and can be wrong, so check
 * it against the source quote before acting.
 */
export type IssueKind = "deterministic" | "probabilistic";

export type GuideEntry = {
  /** Issue code, or "A5" for every A5_* critic finding. Also the page anchor. */
  code: string;
  title: string;
  kind: IssueKind;
  /** null: the agent picks the severity. */
  severity: Severity | null;
  raisedBy: string;
  meaning: string;
  example: { source: string; diagram: string };
  steps: string[];
  doneWhen: string;
};

export const GUIDE: GuideEntry[] = [
  // ---------- deterministic: input ----------
  {
    code: "FILE_UNSUPPORTED",
    title: "File type not supported",
    kind: "deterministic",
    severity: "blocking",
    raisedBy: "normalize (code)",
    meaning: "An uploaded file is not TXT, MD, PDF, PNG, JPEG or WEBP, so nothing in it was read.",
    example: {
      source: "You uploaded SOP_card_dispute.docx.",
      diagram: "No steps from that document appear; the issue says “unsupported type”.",
    },
    steps: [
      "Export the document as PDF (or copy its text into the text box).",
      "Start a new diagram with the PDF and the same other files.",
    ],
    doneWhen: "The new run has no FILE_UNSUPPORTED issue and its Evidence tab lists blocks from that file.",
  },
  {
    code: "SOURCE_UNREADABLE",
    title: "Nothing readable in the input",
    kind: "deterministic",
    severity: "blocking",
    raisedBy: "normalize (code)",
    meaning: "No text or images could be pulled from the input, so the agents had nothing to work from.",
    example: {
      source: "A scanned PDF with no text layer and no pages rendered as images.",
      diagram: "An empty or near-empty diagram.",
    },
    steps: [
      "Open the file and check you can select its text. If not, it is a scan: run it through OCR or upload the pages as PNG.",
      "Check the file is not password-protected or empty.",
      "Start a new diagram with the fixed file.",
    ],
    doneWhen: "The Evidence tab shows text blocks (E1, E2…) or images (IMG1…).",
  },
  // ---------- deterministic: refiner guard ----------
  {
    code: "REFINE_DROPPED_CLAIM",
    title: "Refiner lost steps without a reason",
    kind: "deterministic",
    severity: "blocking",
    raisedBy: "check_refine (code)",
    meaning:
      "A3 merges the extracted steps. Every step A1/A2 found must end up in a merged claim or be dropped with a reason. These IDs vanished silently, so the diagram may be missing steps.",
    example: {
      source: "A1 extracted T_c9 “Verify beneficiary name against account record”.",
      diagram: "No step in the diagram cites T_c9’s evidence block, and the issue lists T_c9.",
    },
    steps: [
      "Open the job page → Graph or Trace tab and find the listed IDs in the A1/A2 output to see what each step said.",
      "For each one, check whether the diagram already has an equivalent step (merged under another name).",
      "If it is missing, add it in the diagram editor: drag a Task into the right lane, type the label, and connect it between the steps before and after it.",
      "If many IDs are listed, re-running the job is usually faster than adding them by hand.",
    ],
    doneWhen: "Every listed step is on the diagram or you have confirmed it is a duplicate; then mark the issue complete.",
  },
  {
    code: "REFINE_DROPPED",
    title: "Refiner dropped a step (with a reason)",
    kind: "deterministic",
    severity: "review",
    raisedBy: "check_refine (code)",
    meaning: "A3 removed an item and gave a reason. The check itself is code; whether the reason is right needs your judgement.",
    example: {
      source: "R_r16 “If amount < SGD 100, reject” and R_r17 say the same thing.",
      diagram: "Issue: “A3 dropped R_r16: duplicate relation for minimum amount rejection outcome.”",
    },
    steps: [
      "Read the reason in the issue message.",
      "Click the issue to see the source quote, and check the diagram still shows that fact once.",
      "If the dropped item was not really a duplicate, add the step or flow back in the editor.",
    ],
    doneWhen: "The fact appears exactly once on the diagram.",
  },
  {
    code: "REFINE_DANGLING_RELATION",
    title: "Refined order points to a missing step",
    kind: "deterministic",
    severity: "review",
    raisedBy: "check_refine (code)",
    meaning: "A3 produced an ordering “X then Y” where X or Y does not exist, so that hand-off may be missing.",
    example: {
      source: "Relation R_r4: R_c3 → R_c12, but R_c12 was never created.",
      diagram: "The step after R_c3 has no outgoing flow, or goes somewhere unexpected.",
    },
    steps: [
      "Find the step the relation starts from on the diagram.",
      "Using the source, decide what really follows it and draw that flow in the editor.",
    ],
    doneWhen: "The step connects to the right next step.",
  },
  {
    code: "EVIDENCE_UNKNOWN",
    title: "Cites evidence that does not exist",
    kind: "deterministic",
    severity: "blocking",
    raisedBy: "check_refine / validate (code)",
    meaning: "An element cites an evidence ID (e.g. E99) that is not in the input. The model may have made up the step or its source.",
    example: {
      source: "Input has blocks E1–E40.",
      diagram: "Task “Escalate to Compliance” cites E57.",
    },
    steps: [
      "Search the source document for the step’s wording.",
      "If you find it, keep the step (the citation was just wrong).",
      "If you cannot find it anywhere, delete the step in the editor and reconnect the flows around it.",
    ],
    doneWhen: "Every remaining step is backed by real source text.",
  },
  {
    code: "COVERAGE_UNCITED",
    title: "Source text not used",
    kind: "deterministic",
    severity: "info",
    raisedBy: "coverage check (code)",
    meaning: "These text blocks were read twice but no step cites them. Often they are titles, purpose statements or glossary, but they may hide a step.",
    example: {
      source: "E27: “Where the dispute exceeds SGD 5,000, obtain Team Lead approval before submission.”",
      diagram: "No approval step appears before “Submit chargeback”.",
    },
    steps: [
      "Click the issue: the source quotes are shown in the card. Read each listed block (Evidence tab has the full list).",
      "Ignore headings, definitions and background text.",
      "For any block that describes an action, approval, decision or rule, add it to the diagram in the right lane and position.",
    ],
    doneWhen: "You have read every listed block and added any real steps.",
  },
  {
    code: "EVENT_LANE_ASSIGNED",
    title: "Start/end moved into a lane",
    kind: "deterministic",
    severity: "info",
    raisedBy: "validate (code)",
    meaning: "A start or end event had no owner, so code moved it next to the step it starts or follows. This is just a note.",
    example: {
      source: "“Customer reports a transaction they believe is incorrect.”",
      diagram: "The start event moved from “Unassigned” to the “Customer Service Officer” lane.",
    },
    steps: ["Check the event now sits in a sensible lane. Drag it to another lane if not."],
    doneWhen: "You agree with the lane. Mark complete.",
  },
  // ---------- deterministic: graph rules ----------
  {
    code: "V01_DUPLICATE_ID",
    title: "Duplicate element",
    kind: "deterministic",
    severity: "blocking",
    raisedBy: "validate V01 (code)",
    meaning: "Two elements share one ID, so BPMN cannot be built cleanly. The draft keeps only the first one.",
    example: {
      source: "—",
      diagram: "Two tasks both called N5: “Log case” and “Notify customer”. Only “Log case” is drawn.",
    },
    steps: [
      "Check the DRAFT_ELEMENTS_DROPPED issue to see which copy was left out.",
      "Add the missing step back in the editor (the editor gives it a new ID automatically) and connect it.",
    ],
    doneWhen: "Both steps appear and are connected.",
  },
  {
    code: "V01_DANGLING_EDGE",
    title: "Flow points to a missing step",
    kind: "deterministic",
    severity: "blocking",
    raisedBy: "validate V01 (code)",
    meaning: "A sequence flow starts or ends at a step that does not exist. It is left out of the draft.",
    example: {
      source: "“If documents are incomplete, return to the customer.”",
      diagram: "Flow F12 “incomplete” → N_return, but N_return was never created. The branch is missing.",
    },
    steps: [
      "Find the source step of the flow and read what the source says should follow.",
      "Create the missing target step if needed, then draw the flow (drag from the arrow in the step’s context pad) and label it.",
    ],
    doneWhen: "The branch is drawn end to end.",
  },
  {
    code: "V01_DANGLING_ANNOTATION",
    title: "Note points to a missing step",
    kind: "deterministic",
    severity: "review",
    raisedBy: "validate V01 (code)",
    meaning: "A text note was meant to attach to a step that does not exist; it now floats unattached.",
    example: { source: "“Note: cut-off time is 3pm SGT.”", diagram: "The note floats with no line to any step." },
    steps: ["Drag a connection from the note to the step it belongs to, or delete it if it adds nothing."],
    doneWhen: "The note is attached or removed.",
  },
  {
    code: "V06_LANE_MISSING",
    title: "Step is in a lane that does not exist",
    kind: "deterministic",
    severity: "blocking",
    raisedBy: "validate V06 (code)",
    meaning: "A step references an unknown lane. In the draft it is placed in an “Unassigned” lane.",
    example: {
      source: "“The Payments Ops team releases the payment.”",
      diagram: "“Release payment” sits in an “Unassigned” lane.",
    },
    steps: [
      "Find who performs the step in the source.",
      "If that role has a lane, drag the step into it. If not, add a lane (right-click the pool → add lane), name it, then move the step.",
      "Delete the “Unassigned” lane once it is empty.",
    ],
    doneWhen: "Every step sits in its owner’s lane.",
  },
  {
    code: "V02_NO_START",
    title: "No start event",
    kind: "deterministic",
    severity: "blocking",
    raisedBy: "validate V02 (code)",
    meaning: "The process has no start, so nothing marks where it begins and no step can be reached.",
    example: { source: "“Upon receipt of a TT instruction form…”", diagram: "The first task “Receive instruction” has no start circle before it." },
    steps: [
      "Drag a Start Event (thin circle) into the lane of the first step.",
      "Label it with the trigger, e.g. “TT instruction received”, and connect it to the first step.",
    ],
    doneWhen: "One start event flows into the first step; V03 unreachable issues also clear.",
  },
  {
    code: "V02_NO_END",
    title: "No end event",
    kind: "deterministic",
    severity: "review",
    raisedBy: "validate V02 (code)",
    meaning: "The process never finishes. The source may simply not state an end, or the end was missed.",
    example: { source: "“…the case is closed and the customer informed.”", diagram: "The last task has no thick end circle after it." },
    steps: [
      "Check the source for how the process finishes (closed, rejected, paid out…).",
      "Add an End Event (thick circle) after each final step and label it with the outcome.",
    ],
    doneWhen: "Each path finishes in a labelled end.",
  },
  {
    code: "V02_START_INCOMING",
    title: "Start event has an incoming flow",
    kind: "deterministic",
    severity: "blocking",
    raisedBy: "validate V02 (code)",
    meaning: "Something flows back into the start. BPMN does not allow it; usually a loop drawn to the wrong place.",
    example: {
      source: "“If the form is rejected, the customer resubmits it.”",
      diagram: "The “resubmit” flow goes back to the start event.",
    },
    steps: ["Select the flow and drag its arrow end onto the first task after the start (the step that is actually repeated)."],
    doneWhen: "The start has only outgoing flow.",
  },
  {
    code: "V02_END_OUTGOING",
    title: "End event has an outgoing flow",
    kind: "deterministic",
    severity: "blocking",
    raisedBy: "validate V02 (code)",
    meaning: "The process continues after an end event, usually a reopen or retry route.",
    example: {
      source: "“Closed cases may be reopened if the customer provides new evidence within 30 days.”",
      diagram: "End “Case closed” → “Reopen case”.",
    },
    steps: [
      "Add a decision (diamond) before the end: “New evidence within 30 days?”.",
      "Connect “No” to the end and “Yes” to “Reopen case”.",
      "Delete the flow that leaves the end event.",
    ],
    doneWhen: "No flow leaves any end event.",
  },
  {
    code: "V03_UNREACHABLE",
    title: "Step can’t be reached",
    kind: "deterministic",
    severity: "review",
    raisedBy: "validate V03 (code)",
    meaning: "No path from the start leads to these steps. They are usually exception steps whose branch was not drawn.",
    example: {
      source: "“If a sanctions hit is confirmed, escalate to Compliance and freeze the payment.”",
      diagram: "“Escalate to Compliance” floats on its own with nothing pointing into it.",
    },
    steps: [
      "Click the issue to highlight the steps.",
      "In the source, find the decision or step that leads to them (here: the sanctions screening check).",
      "Draw a flow from that decision to the first unreachable step and label it with the condition (“Hit confirmed”).",
      "If the step does not belong in this process, delete it.",
    ],
    doneWhen: "Every listed step can be reached from the start.",
  },
  {
    code: "V03_DEAD_END",
    title: "Path leads nowhere",
    kind: "deterministic",
    severity: "review",
    raisedBy: "validate V03 (code)",
    meaning: "A step has no outgoing flow and is not an end, so the process stops there without finishing.",
    example: {
      source: "“Proceed with intake processing; then perform sanctions screening.”",
      diagram: "“Proceed with intake processing” has no arrow out.",
    },
    steps: [
      "Read the source to find what happens after the step.",
      "Connect it to that next step. If the process really finishes there, add an End Event after it.",
    ],
    doneWhen: "The step has an outgoing flow or leads to an end.",
  },
  {
    code: "V04_UNLABELLED_BRANCH",
    title: "Decision branch has no label",
    kind: "deterministic",
    severity: "review",
    raisedBy: "validate V04 (code)",
    meaning: "A decision has an exit with no condition, so a reader cannot tell when that path is taken.",
    example: { source: "“If the amount exceeds SGD 50,000, obtain second approval.”", diagram: "Diamond “Amount > 50k?” has one exit labelled “Yes” and one blank." },
    steps: ["Double-click the blank flow and type the condition from the source (“No” / “≤ SGD 50,000”)."],
    doneWhen: "Every exit of the decision has a label.",
  },
  {
    code: "V04_GATEWAY_BRANCHES",
    title: "Decision needs two or more exits",
    kind: "deterministic",
    severity: "review",
    raisedBy: "validate V04 (code)",
    meaning: "A diamond has only one way out, so it is not a real decision. Either a branch is missing or it should be a task.",
    example: {
      source: "“Screen the name. If a potential match is found, refer to Compliance.”",
      diagram: "Diamond “Potential name match?” has only the “Yes” exit.",
    },
    steps: [
      "Check the source for the other outcome. If it says “otherwise, continue”, draw that flow to the next step and label it.",
      "If the source gives only one outcome, check for a BRANCH_UNSTATED issue and ask the SOP owner.",
      "If it was never a decision, change it to a task (wrench icon → Task).",
    ],
    doneWhen: "The decision has two or more labelled exits, or it is a task.",
  },
  {
    code: "V07_INFERRED",
    title: "Step was inferred",
    kind: "deterministic",
    severity: "info",
    raisedBy: "validate V07 (code)",
    meaning: "The agent marked this step or flow as inferred, not stated in the source. Common and expected; confirm it makes sense.",
    example: { source: "Steps 3 and 4 appear in sequence but nothing says “then”.", diagram: "The flow 3 → 4 is marked inferred." },
    steps: ["Glance at the highlighted element. Keep it if the order or step is obvious; otherwise fix or delete it."],
    doneWhen: "You agree with it. Mark complete.",
  },
  {
    code: "V07_NO_EVIDENCE",
    title: "Step has no evidence",
    kind: "deterministic",
    severity: "review",
    raisedBy: "validate V07 (code)",
    meaning: "The element is marked as from the source but cites nothing, so it cannot be traced.",
    example: { source: "—", diagram: "Task “Archive file” cites no evidence block." },
    steps: [
      "Search the source for the step. If present, keep it.",
      "If you cannot find it, delete it and reconnect the flows around it.",
    ],
    doneWhen: "The step is confirmed or removed.",
  },
  {
    code: "DRAFT_ELEMENTS_DROPPED",
    title: "Elements left out of the draft",
    kind: "deterministic",
    severity: "blocking",
    raisedBy: "compile BPMN (code)",
    meaning: "Blocking structure errors were still there after the repair loop, so these elements could not be drawn. The diagram is marked as a draft.",
    example: { source: "—", diagram: "Red banner “Draft”; flow F12 and a second N5 are missing." },
    steps: [
      "Fix the other Critical issues first (duplicate IDs, dangling flows).",
      "Add each listed element back in the editor and connect it.",
      "Download the corrected .bpmn.",
    ],
    doneWhen: "No elements are missing and no red outlines remain.",
  },
  {
    code: "REVIEW_INCOMPLETE",
    title: "Check not finished",
    kind: "deterministic",
    severity: "blocking",
    raisedBy: "repair loop (code)",
    meaning: "The model request budget ran out before the critic could re-check the repaired diagram. Repairs may be partly right.",
    example: { source: "—", diagram: "Critic findings say “Not re-checked after the final repair”." },
    steps: [
      "Treat every A5 finding as unverified: click each and check whether the diagram already fixes it.",
      "For a long SOP, run it again in smaller sections, or try another provider.",
    ],
    doneWhen: "You have checked each critic finding yourself.",
  },

  // ---------- probabilistic: raised by agents ----------
  {
    code: "OWNER_INFERRED",
    title: "Owner inferred from roles table",
    kind: "probabilistic",
    severity: "review",
    raisedBy: "A1 Text Extractor",
    meaning: "The step names no actor, so the agent took the owner from a roles/responsibilities table. Usually right, but it is the agent’s reading.",
    example: {
      source: "Roles table: “Customer Service Officer — intake and acknowledgement”. Step 3: “Acknowledge the dispute within 2 days.”",
      diagram: "“Acknowledge dispute” is in the Customer Service Officer lane.",
    },
    steps: [
      "Click the issue: the card quotes the step and the roles table.",
      "Check the roles table really assigns this work to that role, and only that role.",
      "If wrong, drag the step into the correct lane.",
    ],
    doneWhen: "You agree with the owner. Mark complete.",
  },
  {
    code: "OWNER_UNKNOWN",
    title: "Owner unknown",
    kind: "probabilistic",
    severity: "review",
    raisedBy: "A1 / A4",
    meaning: "No evidence says who does the step, or more than one role fits, so it sits in “Unassigned”.",
    example: { source: "“The form is checked for completeness.” (no actor named)", diagram: "“Check form completeness” is in the Unassigned lane." },
    steps: [
      "Look for the actor elsewhere in the SOP (roles table, section heading, nearby steps).",
      "If found, move the step to that lane. If not, ask the SOP owner and leave a text note on the step.",
    ],
    doneWhen: "The step has an owner, or the question is recorded as a note.",
  },
  {
    code: "BRANCH_UNSTATED",
    title: "Only one outcome stated",
    kind: "probabilistic",
    severity: "review",
    raisedBy: "A1 decisions pass",
    meaning: "The source gives only one outcome of a decision. The agent is told never to invent the other, so it is left open.",
    example: {
      source: "“If the cardholder confirms the transaction, close the case.”",
      diagram: "“Cardholder confirms?” has only the “Yes → Close case” exit.",
    },
    steps: [
      "Re-read the paragraph and the next section: the other outcome is often stated later (“Otherwise…”, an exceptions table).",
      "If found, draw it from the decision and label it.",
      "If the SOP really never says, do not guess: add a note “Outcome not defined in SOP” and raise it with the process owner.",
    ],
    doneWhen: "Each decision has all its outcomes, or the gap is noted for the SOP owner.",
  },
  {
    code: "INFERRED_RELATION",
    title: "Order implied, not stated",
    kind: "probabilistic",
    severity: "review",
    raisedBy: "A3 Extraction Refiner",
    meaning: "The agent linked two steps because the order seemed implied (e.g. by section layout), not because the text says “then”.",
    example: {
      source: "Section 4 “Intake”, then section 5 “Minimum amount check”.",
      diagram: "Flow “Receive instruction” → “Minimum amount?” marked inferred.",
    },
    steps: ["Check the order makes business sense. If the steps can run in another order or in parallel, redraw the flows."],
    doneWhen: "You agree with the order. Mark complete.",
  },
  {
    code: "SOURCE_CONFLICT",
    title: "Sources disagree",
    kind: "probabilistic",
    severity: null,
    raisedBy: "A1 / A2",
    meaning: "Two parts of the input say different things (text vs diagram, or two sections). The agent kept both rather than choosing.",
    example: {
      source: "Text: “Team Lead approves above SGD 10,000.” Old diagram: “Manager approves above SGD 5,000.”",
      diagram: "Approval step cites both; the threshold is unclear.",
    },
    steps: [
      "Click the issue to see both quotes.",
      "Ask the SOP owner which is current (the newer document usually wins).",
      "Edit the step and decision label to the correct value.",
    ],
    doneWhen: "The diagram shows the confirmed rule.",
  },
  {
    code: "SOURCE_INCOMPLETE",
    title: "Source is incomplete",
    kind: "probabilistic",
    severity: null,
    raisedBy: "A1 / A2 / A4",
    meaning: "The input refers to something not supplied: another page, an appendix, an off-page connector, or text beyond the demo limit.",
    example: {
      source: "“Follow the escalation procedure in Appendix C.” Appendix C was not uploaded.",
      diagram: "A note “Continues in Appendix C” with nothing after it.",
    },
    steps: [
      "Find the missing appendix or page.",
      "If it matters for this process, run again with it included (or in smaller sections if the input was too long).",
      "Otherwise leave the note so readers know where the process continues.",
    ],
    doneWhen: "The missing part is included or clearly noted.",
  },
  {
    code: "CONNECTOR_UNCERTAIN",
    title: "Arrow in image unclear",
    kind: "probabilistic",
    severity: null,
    raisedBy: "A2 Diagram Interpreter",
    meaning: "An arrow in the uploaded diagram image could not be read (end or direction unclear), so it was not drawn as a firm flow.",
    example: { source: "Blurred image where two arrows cross near “Verify ID”.", diagram: "“Verify ID” is missing a flow, or has one with an unknown target." },
    steps: [
      "Open the original image and trace the arrow yourself.",
      "Draw the correct flow in the editor. If you cannot tell either, ask the diagram’s owner.",
    ],
    doneWhen: "The flow matches the original diagram.",
  },
  {
    code: "TEXT_UNREADABLE",
    title: "Text in image unreadable",
    kind: "probabilistic",
    severity: null,
    raisedBy: "A2 Diagram Interpreter",
    meaning: "A label in an uploaded image (or the whole image) could not be read, so the shape has no name or was skipped.",
    example: { source: "Low-resolution screenshot of a Visio flow.", diagram: "A task with an empty label, or no shapes from that image." },
    steps: [
      "Upload a higher-resolution image or the original PDF/Visio export and run again.",
      "Or type the label yourself in the editor (double-click the shape).",
    ],
    doneWhen: "Every shape has the correct label.",
  },
  {
    code: "A5",
    title: "Evidence Critic finding (A5_…)",
    kind: "probabilistic",
    severity: null,
    raisedBy: "A5 Evidence Critic",
    meaning:
      "The critic compared the diagram with the original source and found something omitted, unsupported or wrong. Codes vary (A5_UNSUPPORTED_SEQUENCE, A5_MISSING_EXCEPTION_PROTOCOL…). The message explains it and often suggests a fix.",
    example: {
      source: "“Before releasing a high-value payment to a new beneficiary, perform independent call-back verification.”",
      diagram: "A5_MISSING_CONTROL: “Call-back verification” is missing (or floats unconnected) before “Release payment”.",
    },
    steps: [
      "Read the message and its “Suggested:” part.",
      "Click the issue to highlight the elements and read the source quote. The critic can be wrong, so confirm the source really says it.",
      "If it is right, make the change in the editor (add the step, fix the order or owner, add the missing branch).",
      "If the message starts “Not re-checked after the final repair”, look first: it may already be fixed.",
    ],
    doneWhen: "The diagram matches the source on this point, or you have confirmed the finding is wrong. Mark complete.",
  },
];

const BY_CODE = new Map(GUIDE.map((g) => [g.code, g]));

/** The guide entry for an issue code; every A5_* finding shares one entry. */
export const guideFor = (code: string) => BY_CODE.get(code.startsWith("A5_") ? "A5" : code);
