---
name: to-prompt
description: Write a handoff prompt for a fresh agent.
argument-hint: "(optional) what to hand off"
disable-model-invocation: true
---

Turn one task from this session into a **brief** the user pastes to another agent. The task is `$ARGUMENTS`, or whatever was most recently under discussion.

## The brief

A few plain sentences, written as the user would say them to a colleague: what is wanted, why it matters, and what is true once it is done.

The brief carries the goal and what the reader needs to understand it. The approach is the reader's to work out, so conclusions reached in this session about how to do it stay out, and the reader forms its own view.

Every sentence stands alone: replace "as discussed" and names coined in this session with the thing itself.

## Output

The brief in one fenced code block, and nothing before it.

A **call** is a choice that belongs to the user rather than the reader. Keep calls out of the brief and list them under the block as `Your call:`, one line each. With no calls, the block is the whole reply.
