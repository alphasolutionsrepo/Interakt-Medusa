import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, Text, toast } from "@medusajs/ui"
import { useMutation } from "@tanstack/react-query"
import { sdk } from "../lib/sdk"

type ReindexResponse = {
  productsBuilt: number
  warnings: number
  load: {
    success: boolean
    total: number
    indexed: number
    failed: number
    errors: number
  } | null
}

const PushAllToInteraktWidget = () => {
  const mutation = useMutation({
    mutationFn: async () =>
      sdk.client.fetch<ReindexResponse>("/admin/search-index/reindex", {
        method: "POST",
      }),
    onSuccess: (data) => {
      if (!data.load) {
        toast.error("Push failed", {
          description: "No result returned from the index.",
        })
        return
      }
      if (!data.load.success || data.load.failed > 0) {
        toast.warning("Push completed with errors", {
          description: `${data.load.indexed}/${data.load.total} indexed, ${data.load.failed} failed.`,
        })
        return
      }
      toast.success("Pushed to Interakt", {
        description:
          `${data.load.indexed} product${data.load.indexed === 1 ? "" : "s"} indexed` +
          (data.warnings > 0
            ? `, ${data.warnings} warning${data.warnings === 1 ? "" : "s"}`
            : ""),
      })
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : "Could not reach the search index. Check the server logs."
      toast.error("Push to Interakt failed", { description: message })
    },
  })

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Interakt search index</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Push every published product to the Interakt search index. Use
            this after a bulk import or a price/category change, since those
            don&apos;t sync automatically.
          </Text>
        </div>
        <Button
          size="small"
          variant="secondary"
          isLoading={mutation.isPending}
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Push all to Interakt
        </Button>
      </div>
      {mutation.isSuccess && mutation.data.load && (
        <div className="px-6 py-4">
          <Text size="small">
            Last push: {mutation.data.load.indexed}/{mutation.data.load.total}{" "}
            indexed
            {mutation.data.load.failed > 0
              ? `, ${mutation.data.load.failed} failed`
              : ""}
            {mutation.data.warnings > 0
              ? `, ${mutation.data.warnings} warnings`
              : ""}
            .
          </Text>
        </div>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.list",
})

export default PushAllToInteraktWidget
