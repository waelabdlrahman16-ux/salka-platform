import { removeMenuItemImages } from "./index.ts"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function storageMock(pages: Array<Array<{ id: string | null; name: string }>>, removeError?: string) {
  const removed: string[][] = []
  const offsets: number[] = []
  return {
    removed,
    offsets,
    client: {
      storage: {
        from(bucket: string) {
          assert(bucket === "vendor-assets", "unexpected bucket")
          return {
            list(_path: string, options: { offset: number }) {
              offsets.push(options.offset)
              return Promise.resolve({ data: pages.shift() ?? [], error: null })
            },
            remove(paths: string[]) {
              removed.push(paths)
              return Promise.resolve({ error: removeError ? { message: removeError } : null })
            },
          }
        },
      },
    },
  }
}

Deno.test("removes every file from the exact menu item folder", async () => {
  const firstPage = Array.from({ length: 100 }, (_, i) => ({ id: String(i), name: `old-${i}.jpg` }))
  const mock = storageMock([firstPage, [{ id: "current", name: "current.jpg" }]])

  const result = await removeMenuItemImages(mock.client, { restaurantId: 22, itemId: 913 })

  assert(result.complete && result.removed === 101, "cleanup count was not returned")
  assert(mock.offsets.join(",") === "0,100", "list did not paginate")
  assert(mock.removed.length === 1, "remove should be called once")
  assert(mock.removed[0][0] === "menu-items/22/913/old-0.jpg", "wrong folder was removed")
  assert(mock.removed[0][100] === "menu-items/22/913/current.jpg", "last page was not removed")
})

Deno.test("does not call remove for an empty folder", async () => {
  const mock = storageMock([[]])

  const result = await removeMenuItemImages(mock.client, { restaurantId: 22, itemId: 913 })

  assert(result.complete && result.removed === 0, "empty cleanup should succeed")
  assert(mock.removed.length === 0, "remove was called for an empty folder")
})

Deno.test("reports a Storage remove failure to the caller", async () => {
  const mock = storageMock([[{ id: "one", name: "one.jpg" }]], "storage unavailable")
  let message = ""

  try {
    await removeMenuItemImages(mock.client, { restaurantId: 22, itemId: 913 })
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }

  assert(message === "remove_failed:storage unavailable", "remove failure was swallowed")
})
