# Hawk architecture note

**What the AI does.** Hawk uses a disclosed, deterministic mock for four AI tasks. It turns the manager’s request into a draft watcher, reviews the proposed proof rules for ambiguity, suggests what a message might prove with an exact excerpt, and phrases alerts using a fixed template. The mock receives text supplied by the application and has no tools or credentials.

**What the code does.** Python reads only approved threads and verifies each candidate against the original message, the author’s eligibility, and the approved proof rule. It records evidence, suppresses repeat alerts, reports blocked sources and missed checks, and stops the watcher when the goal is proven or the watch expires. For the mobile watcher, a build link and login details establish that access details were supplied. Only the manager’s own qualifying messages confirm access to both apps. Preview and scheduled checks share the same evaluator, and a manager must approve every rule version.

**What I’d build next.** I’d pilot Hawk with organizational sign-in and one read-only collaboration connector. I’d run a live model in shadow mode on labeled messages and measure false confirmations, missed confirmations, and duplicate alerts separately. Those results would guide when to enable live alerts. The deterministic verifier and human approval would remain in the decision path.

**What I’d ask the manager.** How long can a promise go without new verified evidence before you’d want it moved to Needs attention, assuming Hawk’s checks are succeeding?
