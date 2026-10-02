import { BookOpen, Github, Mail } from "lucide-react"
import { Button } from "~/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog"
import { DOCS_HOME_URL, GITHUB_ISSUES_URL, SUPPORT_EMAIL } from "../../shared/constants"
import { bridge } from "../lib/bridge"
import { hasPaidLicense, useLicense } from "../lib/license"

/** Docs for everyone; email support for Pro and MSP, a GitHub issue for Community. */
export function SupportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { status } = useLicense()
  const licensed = status ? hasPaidLicense(status) : false
  const openLink = (url: string) => {
    void bridge.app.openExternal(url)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Support</DialogTitle>
          <DialogDescription>
            {licensed
              ? "Browse the documentation, or email us and we will get back to you."
              : "Browse the documentation, or report a problem on GitHub."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Button variant="outline" className="justify-start" onClick={() => openLink(DOCS_HOME_URL)}>
            <BookOpen className="mr-2 h-4 w-4" />
            Documentation
          </Button>
          {licensed ? (
            <Button className="justify-start" onClick={() => openLink(`mailto:${SUPPORT_EMAIL}`)}>
              <Mail className="mr-2 h-4 w-4" />
              Email Support
            </Button>
          ) : (
            <Button className="justify-start" onClick={() => openLink(GITHUB_ISSUES_URL)}>
              <Github className="mr-2 h-4 w-4" />
              Open GitHub issue
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
