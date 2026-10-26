Classify what the agent did with this webhook or ticket request, based on the tool calls and final output.
- answered_from_kb: replied to the customer with an answer drawn from a knowledge base match.
- escalated: told the customer a human agent will follow up.
- learned_qa: added a Q&A pair to the knowledge base from a human-solved ticket.
- skipped_learning: handled a solved ticket but added nothing (bot-solved, duplicate, or no clear Q&A).
- failed: a tool call errored or the run ended without completing a path.
- other: none of the above, such as an unparseable request.
