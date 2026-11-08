# GetSales: n8n nodes

`@getsales/n8n-nodes-getsales` connects [GetSales](https://getsales.io/) to your n8n workflows. GetSales is LinkedIn and email outreach for agencies and GTM teams, in one app. Describe who you sell to, and GetSales finds the people and their work emails, scores them and writes the first lines, and every reply comes back to a team inbox.

With this package, a reply, a task or a website visit in GetSales starts an n8n workflow, and the GetSales node adds people to your tables and GetSales workflows, finds people and reads messages. Everything runs in your own GetSales workspace, with an API key from it.

## What is in the package?

- **GetSales Trigger** starts an n8n workflow on GetSales events: a reply, a task, a change in a conversation, a lead leaving a GetSales workflow, an identified website visit, a finished import, or any event of the catalog.
- **GetSales** works on people, GetSales workflows and messages: Person: Add to Table, Person: Find, Workflow: Add People and Message: Get. It can also serve as a tool of an n8n AI Agent.
- **GetSales API** is the credential both nodes use. It has one field, the API key.

## How do I install it?

On a self-hosted n8n, an owner or admin opens **Settings**, **Community nodes**, clicks **Install** and enters the package name:

```
@getsales/n8n-nodes-getsales
```

n8n Cloud installs only the community nodes that n8n has verified. This package is not one of them, so it runs on a self-hosted n8n.

## Where do I get the API key?

In GetSales, open **Settings**, **API keys** and click **Create key**. Copy the secret when it appears: it starts with `gs_live_`, it is shown once, and a key works for one workspace. Then create a **GetSales API** credential in n8n and paste the key. n8n checks it with a read of your tables.

The key needs these permissions for what you use:

| Node or operation | Permission |
| --- | --- |
| Credential check, the table list | `can_view_playtables` |
| Person: Add to Table | `can_act_people` |
| Person: Find | `can_view_people` |
| Workflow: Add People | `can_act_workflows`, and `can_view_workflows` for the workflow list |
| Message: Get | `can_view_conversations` |
| GetSales Trigger | `can_view_webhooks` and `can_manage_webhooks` |

The **Automation platform** preset of the key dialog holds every permission above. A key can do in your workspace whatever its permissions allow, through any client, so give it only what you use.

## Which events can start a workflow?

Pick one under **Trigger On**:

| Trigger On | GetSales events it subscribes to |
| --- | --- |
| Reply Received | `messages.received` |
| Task Created | `tasks.created`, your AI SDR's hand-offs included |
| Conversation State Changed | `conversations.state-changed` |
| Lead Finished or Left a Workflow | `workflow-records.completed`, `workflow-records.exited` |
| Website Visit Identified | `signals.website-visited` |
| Import or Search Finished | `playtable-runs.finished`, `data-sources.completed` |
| Any of These Events | the events you pick from the full catalog of 33 |

When the n8n workflow goes active, the trigger subscribes its URL to those events in GetSales. When it goes inactive, that subscription is deleted. GetSales sends deliveries only to https addresses on a public host, so a self-hosted n8n needs a public https URL for the trigger to receive them.

Every delivery is signed. The trigger checks the `X-Webhook-Signature` header, an HMAC-SHA256 of the timestamp and the raw body made with the subscription's secret, and answers 401 to a delivery whose signature does not match or is more than five minutes old. A delivery with no signature or no body gets the same 401, so nothing unsigned starts your workflow.

## What does a delivery carry?

Each delivery becomes one n8n item holding the envelope GetSales sent: `type` is the event name, `payload` carries the event's own fields, and `webhook_log_sid`, `emitted_at`, `team_sid` and `trace_id` come with it. A payload is a short reference, mostly sids, and never the text of a message:

- **Reply Received**: the message's `sid`, `conversation_sid`, `channel`, `kind`, `provider_message_sid` and `created_at`.
- **Task Created**: the task's `sid`, `title`, `due_at`, `assignee_user_sid`, `created_by` and `created_at`, with the `conversation_sid` and `person_sid` it belongs to.
- **Conversation State Changed**: the conversation's `sid`, `state`, `previous_state` and `snoozed_until`.
- **Lead Finished or Left a Workflow**: the workflow record's `sid` and `status`, the `workflow_sid`, the person as `people_sid`, `finished_at`, and `event`, the event name again.
- **Website Visit Identified**: the visit as `session_sid`, with `site_domain`, `entry_path`, `key_pages`, `forms`, `attribution`, `pageviews_count` and `engaged_seconds`, the `person_sid` or `company_sid` it was matched to, and `live`, true while the visit is still open.
- **Import or Search Finished**: for a table run, its `sid`, `playtable_sid`, `type`, `finished_at`, `total_jobs` and `failed_jobs`, plus `file_url`, which only an export fills. For a data source, its `sid`, `playtable_sid`, `type` and its counts, from `items_collected` to `items_failed`.

Most payloads repeat `team_sid` as well. An event picked under Any of These Events carries its own fields in the same short form. The envelope and the catalog are described in [Receive webhooks](https://docs.getsales.io/guides/receive-webhooks).

## What can the GetSales node do?

**Person: Add to Table** adds a person to the table you pick, with a full name, a work email, a LinkedIn member ID and a LinkedIn public ID, and under Additional Fields a company name, a personal email, a work phone and profile URNs. A person GetSales already has comes back as it is, with `already_exists: true`, and is not changed. The output is the person, so the next node can use its `sid`.

**Person: Find** looks people up in all your tables or in one, by work email, LinkedIn member ID, LinkedIn public ID or free text over names, company names, emails and public IDs. A work email or a public ID is trimmed and lowercased before the search, so `Maya@Example.com` finds `maya@example.com`. It returns one item per person, up to **Max Results**. Options attach each person's company and the cells of their table's custom columns.

**Workflow: Add People** enrolls people in an active, published GetSales workflow by their person SID (`cr_pp_...`, the `sid` a Person operation returns). All input items go out together, in batches of up to 500, one call each. GetSales adds them through the workflow's manual source, and creates one named Hand-picked when there is none. Everyone the workflow holds already is left as they are, a finished journey too, so a retried or repeated run re-runs nobody. It returns one summary item per GetSales workflow with the counts GetSales reports: entered, already enrolled, blocked by your stoplist, and so on.

**Message: Get** reads a message and its conversation by the message SID (`ub_ms_...`). The conversation's participants are attached by default, and its 30 newest messages on request.

## How do I get the text of a reply?

A Reply Received delivery holds the message's sid and no text. Add a GetSales node after the trigger, choose **Message: Get** and set **Message SID** to `{{ $json.payload.sid }}`. The message comes back with `body_text`, and the conversation with its state, the scenario your AI SDR read it as, and its participants.

Here are those two nodes, ready to paste on a blank canvas in n8n. Pick your GetSales credential in each of them afterwards:

```json
{
  "nodes": [
    {
      "parameters": { "triggerOn": "replyReceived" },
      "name": "Reply received",
      "type": "@getsales/n8n-nodes-getsales.getSalesTrigger",
      "typeVersion": 1,
      "position": [0, 0]
    },
    {
      "parameters": {
        "resource": "message",
        "operation": "get",
        "messageSid": "={{ $json.payload.sid }}",
        "options": {}
      },
      "name": "Read the reply",
      "type": "@getsales/n8n-nodes-getsales.getSales",
      "typeVersion": 1,
      "position": [240, 0]
    }
  ],
  "connections": {
    "Reply received": { "main": [[{ "node": "Read the reply", "type": "main", "index": 0 }]] }
  }
}
```

## Are there example workflows?

Yes, three, in the `examples` folder of the repository. Import one from the workflow menu in n8n (**Import from File**), then pick your credentials and whatever each node asks for: a table, a GetSales workflow or a Slack channel. Each one opens with a note that says how to set it up.

- [`examples/reply-to-slack.json`](examples/reply-to-slack.json): Reply Received, then Message: Get, then the reply's text in a Slack channel.
- [`examples/form-lead-to-workflow.json`](examples/form-lead-to-workflow.json): an n8n form, then Person: Add to Table, then Workflow: Add People. A repeated submission starts nothing twice.
- [`examples/website-visit-to-slack.json`](examples/website-visit-to-slack.json): Website Visit Identified, then a Slack message with the site, the page and the time on it.

## Do the GetSales nodes send messages?

No. Nothing in this package sends on a channel. To start outreach from n8n, enroll people in a GetSales workflow you built in the app: the workflow's own steps run from your sender profiles, and your stoplist still applies. A sender profile is the identity your team sends as, with its LinkedIn account and its mailboxes.

## Can an AI agent use the node?

Yes. Attach the GetSales node to an n8n AI Agent as a tool, and the agent can add, find and enroll people and read messages in your workspace.

## What does the credential call?

The **GetSales API** credential is there for the calls these two nodes make, and this package supports no other use of it. Each call goes to the GetSales API host, with the key as a bearer token:

| Used by | Calls |
| --- | --- |
| Credential check, the table list | `POST /playtables/v1/api/playtables/search` |
| Person: Add to Table | `POST /playtables/v1/api/people` |
| Person: Find | `POST /playtables/v1/api/people/search` |
| The workflow list | `POST /playtables/v1/api/workflows/search` |
| Workflow: Add People | `POST /playtables/v1/api/workflows/{sid}/add-people` |
| Message: Get | `POST /unibox/v1/api/messages/search` and `GET /unibox/v1/api/conversations/{sid}` |
| GetSales Trigger | `POST /integrations/v1/api/webhooks`, `GET /integrations/v1/api/webhooks/{sid}` and `DELETE /integrations/v1/api/webhooks/{sid}` |

Each of these reads or writes records in your workspace: tables, people, GetSales workflows, messages and the trigger's own subscription.

## What does it cost?

The [pricing page](https://getsales.io/pricing/) lists the API and webhooks on the free Playtables & Data plan. Data credits are spent by what an action starts inside GetSales, such as a column that runs on every new row, at the rates on that page.

## How do I build it from source?

```sh
npm ci
npm run build    # compile to dist/ and copy the icons and codex files
npm run lint     # tsc, then the lint rules n8n's package scanner applies
npm test         # unit tests, with every API call mocked
npm run scan     # needs Docker: the scanner's own lint over the source and the packed tarball
```

A release starts from a `v*` tag that matches the version in `package.json`. One GitHub Actions job lints, tests and packs the package, and a second job, the only one allowed to request a publishing token, sends that tarball to npm with provenance.

## Links

- [GetSales developer docs](https://docs.getsales.io)
- [Authentication and API keys](https://docs.getsales.io/authentication)
- [Receive webhooks](https://docs.getsales.io/guides/receive-webhooks)
- [Integrations](https://getsales.io/integrations/)
- [AI SDR](https://getsales.io/ai-sdr/)
- [Unified inbox](https://getsales.io/unified-inbox/)
- [Website visitor identification](https://getsales.io/website-visitor-identification/)
- [Pricing](https://getsales.io/pricing/)

## Trademarks

n8n is a trademark of n8n GmbH. GetSales is not endorsed by or a partner of n8n.

GetSales is an independent product and is not affiliated with, endorsed by, or sponsored by LinkedIn Corporation. LinkedIn and the LinkedIn logo are trademarks of LinkedIn Corporation. Use of GetSales is at your own risk and subject to the applicable third-party platform terms.

## License

MIT. See [LICENSE](LICENSE).
