import { DialogHelper } from "zotero-plugin-toolkit"
import { featureViaBridge, FeatureDefinition } from "../extract/pybridge"
import { resolveOutputTarget } from "../core/pc-discovery"
import { getSelectedRegularItems, getPaperMeta } from "../apis/zotero/item"
import { findExisting } from "../core/papers-index"
import { pdfFilePath } from "../extract/pdfjs"
import { extractTextCached } from "../extract/text"
import { getString } from "../utils/locale"
import { processItem } from "../core/pipeline"
import { featureReportHtml } from "../render/featureReport"

declare const Services: any

/** The desktop never duplicates the CLI's capability list or requirements. */
export async function openFeaturePanel(
  selectedFeature?: string,
): Promise<void> {
  const target = await resolveOutputTarget()
  const manifest = await featureViaBridge(target.root)
  if (!Array.isArray(manifest.features))
    throw new Error("Invalid shared feature registry")
  const features = manifest.features as FeatureDefinition[]
  const selected = getSelectedRegularItems()[0]
  const meta = selected ? getPaperMeta(selected) : undefined
  const existing = meta
    ? await findExisting(target.papersDir, {
        doi: meta.doi,
        zoteroKey: meta.key,
        title: meta.title,
      })
    : undefined
  const selectedPdf = selected ? await pdfFilePath(selected) : undefined
  const dialog = new DialogHelper(1, 1)
  dialog.addCell(0, 0, {
    tag: "div",
    namespace: "html",
    id: "pc-features",
    children: [
      {
        tag: "p",
        namespace: "html",
        properties: { textContent: getString("feature-intro") },
      },
    ],
  })
  dialog.setDialogData({
    loadCallback: () => {
      const doc = dialog.window.document
      const container = doc.getElementById(
        "pc-features",
      ) as unknown as HTMLElement
      container.setAttribute(
        "style",
        "padding:16px;max-height:80vh;overflow:auto;font:14px sans-serif",
      )
      const create = (tag: string) =>
        doc.createElementNS("http://www.w3.org/1999/xhtml", tag) as HTMLElement
      const navigation = create("nav")
      let route = String(
        features.find((f) => f.id === selectedFeature)?.start_path || "reading",
      )
      const showRoute = () => {
        for (const element of Array.from(
          container.querySelectorAll("details[data-start-path]"),
        )) {
          const card = element as HTMLElement
          card.hidden = card.dataset.startPath !== route
        }
      }
      for (const name of ["reading", "ai", "collection", "optional"]) {
        const button = create("button") as HTMLButtonElement
        button.textContent = getString(`feature-route-${name}`)
        button.addEventListener("click", () => {
          route = name
          showRoute()
        })
        navigation.append(button)
      }
      container.append(navigation)
      for (const feature of features) {
        const card = create("details")
        card.dataset.startPath = String(feature.start_path || "optional")
        if (feature.id === selectedFeature) card.setAttribute("open", "")
        card.style.cssText =
          "border:1px solid #bbb;padding:12px;margin:8px 0;border-radius:6px"
        const heading = create("summary")
        heading.textContent = `${feature.group || feature.module} · ${feature.label_ko} / ${feature.label_en}`
        card.append(heading)
        const description = create("pre")
        description.style.whiteSpace = "pre-wrap"
        const { params_schema: _, ...capability } = feature
        description.textContent = JSON.stringify(capability, null, 2)
        card.append(description)
        if (feature.id === "review") {
          const note = create("p")
          note.textContent = getString("feature-use-review")
          const button = create("button") as HTMLButtonElement
          button.textContent = getString("feature-plan")
          const result = create("pre")
          result.style.whiteSpace = "pre-wrap"
          button.addEventListener("click", async () => {
            button.disabled = true
            try {
              const items = getSelectedRegularItems()
              if (!items.length) throw new Error("No papers selected")
              for (const item of items)
                result.textContent = JSON.stringify(
                  await processItem(item),
                  null,
                  2,
                )
            } catch {
              result.textContent = getString("feature-execution-failed")
            } finally {
              button.disabled = false
            }
          })
          card.append(note, button, result)
          container.append(card)
          continue
        }
        const provider = create("select") as HTMLSelectElement
        const providers = feature.supported_providers || []
        for (const id of providers) {
          const option = create("option") as HTMLOptionElement
          option.value = id
          option.textContent = id
          provider.append(option)
        }
        if (providers.length) card.append(provider)
        const inputs = new Map<
          string,
          { element: HTMLInputElement | HTMLTextAreaElement; type: string }
        >()
        for (const [name, spec] of Object.entries(
          feature.params_schema?.properties || {},
        )) {
          const label = create("label")
          label.style.cssText = "display:block;margin-top:8px"
          label.textContent = `${name}${feature.params_schema?.required?.includes(name) ? " *" : ""} — ${spec.description || ""}`
          const type = spec.type || "string"
          const input = create(
            type === "object" || type === "array" ? "textarea" : "input",
          ) as HTMLInputElement | HTMLTextAreaElement
          input.style.cssText = "display:block;width:95%"
          if (input.tagName.toLowerCase() === "input")
            (input as HTMLInputElement).type = "text"
          input.value =
            spec.default === undefined
              ? ""
              : typeof spec.default === "string"
                ? spec.default
                : JSON.stringify(spec.default)
          if (name === "slug" && existing?.slug) input.value = existing.slug
          if (
            name === "topic" &&
            existing?.primary_topic &&
            existing.primary_topic !== "uncategorized"
          )
            input.value = existing.primary_topic
          if (name === "pdf_path" && selectedPdf) input.value = selectedPdf
          label.append(input)
          card.append(label)
          inputs.set(name, { element: input, type })
        }
        const costCap = create("input") as HTMLInputElement
        costCap.type = "number"
        costCap.min = "0"
        costCap.step = "0.01"
        costCap.placeholder = getString("feature-budget-cap")
        const rateInput = create("input") as HTMLInputElement
        rateInput.type = "number"
        rateInput.min = "0"
        rateInput.placeholder = getString("feature-input-rate")
        const rateOutput = create("input") as HTMLInputElement
        rateOutput.type = "number"
        rateOutput.min = "0"
        rateOutput.placeholder = getString("feature-output-rate")
        card.append(costCap, rateInput, rateOutput)
        const status = create("pre")
        status.style.cssText =
          "white-space:pre-wrap;max-height:300px;overflow:auto"
        const planButton = create("button") as HTMLButtonElement
        planButton.textContent = getString("feature-plan")
        const executeButton = create("button") as HTMLButtonElement
        executeButton.textContent = getString("feature-execute")
        executeButton.disabled = true
        const exportButton = create("button") as HTMLButtonElement
        exportButton.textContent = getString("feature-export")
        exportButton.disabled = true
        const htmlButton = create("button") as HTMLButtonElement
        htmlButton.textContent = getString("feature-export-html")
        htmlButton.disabled = true
        htmlButton.addEventListener("click", async () => {
          const { FilePickerHelper } = await import("zotero-plugin-toolkit")
          const path = await new FilePickerHelper(
            "Export portable report",
            "save",
            [["HTML", "*.html"]],
            `${feature.id}.html`,
          ).open()
          if (!path) return
          const { writeText } = await import("../utils/fs")
          const result = JSON.parse(status.textContent || "{}")
          await writeText(
            String(path),
            featureReportHtml(
              `${feature.label_ko} / ${feature.label_en}`,
              result,
            ),
          )
        })
        exportButton.addEventListener("click", async () => {
          const { FilePickerHelper } = await import("zotero-plugin-toolkit")
          const path = await new FilePickerHelper(
            "Export module result",
            "save",
            [["JSON", "*.json"]],
            `${feature.id}.json`,
          ).open()
          if (!path) return
          const { writeText } = await import("../utils/fs")
          await writeText(String(path), status.textContent || "")
        })
        const sourcesButton = create("button") as HTMLButtonElement
        sourcesButton.textContent = getString("feature-selected-sources")
        sourcesButton.addEventListener("click", async () => {
          invalidate()
          const sourceRevision = revision
          sourcesButton.disabled = true
          planButton.disabled = true
          try {
            const sources = []
            for (const item of getSelectedRegularItems()) {
              const extracted = await extractTextCached(item)
              sources.push({
                id: item.key,
                title: item.getDisplayTitle(),
                text: extracted.text,
              })
            }
            if (sourceRevision !== revision) return
            const direct = inputs.get("sources")
            if (direct) direct.element.value = JSON.stringify(sources)
            else {
              const nested = inputs.get("request")
              if (!nested)
                throw new Error("This capability does not accept text sources")
              const request = nested.element.value
                ? JSON.parse(nested.element.value)
                : {}
              nested.element.value = JSON.stringify({
                ...request,
                schema_version: 1,
                feature: feature.id,
                provider: provider.value,
                sources,
              })
            }
            invalidate()
            status.textContent = getString("feature-sources-ready")
          } catch {
            status.textContent = getString("feature-source-failed")
          } finally {
            sourcesButton.disabled = false
            planButton.disabled = false
          }
        })
        let planned: Record<string, unknown> | undefined
        let revision = 0
        const invalidate = () => {
          revision++
          planned = undefined
          executeButton.disabled = true
          exportButton.disabled = true
          htmlButton.disabled = true
        }
        const request = () => {
          const params: Record<string, unknown> = {}
          for (const [name, { element, type }] of inputs) {
            if (!element.value.trim()) continue
            params[name] =
              type === "string" ? element.value : JSON.parse(element.value)
          }
          const result: Record<string, unknown> = {
            schema_version: 1,
            feature: feature.id,
            params,
          }
          if (provider.value) result.provider = provider.value
          if (costCap.value)
            result.budget = {
              max_cost_usd: Number(costCap.value),
              ...(rateInput.value
                ? { input_per_million_usd: Number(rateInput.value) }
                : {}),
              ...(rateOutput.value
                ? { output_per_million_usd: Number(rateOutput.value) }
                : {}),
              max_output_tokens: 4000,
            }
          return result
        }
        card.addEventListener("input", invalidate)
        card.addEventListener("change", invalidate)
        planButton.addEventListener("click", async () => {
          planButton.disabled = true
          planned = undefined
          executeButton.disabled = true
          const planRevision = revision
          try {
            const candidate = request()
            const result = await featureViaBridge(target.root, candidate)
            if (
              planRevision !== revision ||
              JSON.stringify(candidate) !== JSON.stringify(request())
            )
              return
            status.textContent = JSON.stringify(result, null, 2)
            planned = result.status === "ready" ? candidate : undefined
            executeButton.disabled = !planned
          } catch {
            status.textContent = getString("feature-invalid-request")
          } finally {
            planButton.disabled = false
          }
        })
        executeButton.addEventListener("click", async () => {
          executeButton.disabled = true
          planButton.disabled = true
          try {
            if (!planned) return
            const approved = planned
            const approvedRevision = revision
            if (
              !Services.prompt.confirm(
                dialog.window,
                "Paper Curio",
                getString("feature-confirm") + "\n" + status.textContent,
              )
            )
              return
            if (
              approvedRevision !== revision ||
              JSON.stringify(approved) !== JSON.stringify(request())
            )
              return
            planned = undefined
            const result = await featureViaBridge(target.root, approved, true)
            status.textContent = JSON.stringify(result, null, 2)
            exportButton.disabled = false
            htmlButton.disabled =
              result.status !== "completed" ||
              !["summary", "chat", "comparison"].includes(feature.id)
            planned = undefined
          } catch {
            status.textContent = getString("feature-execution-failed")
          } finally {
            planButton.disabled = false
          }
        })
        if (inputs.has("sources") || inputs.has("request"))
          card.append(sourcesButton)
        card.append(planButton, executeButton, exportButton, htmlButton, status)
        container.append(card)
      }
      showRoute()
    },
  })
  dialog.open("Paper Curio — Modules", {
    width: 850,
    height: 700,
    resizable: true,
    centerscreen: true,
  })
}
