import UIKit
import Capacitor
import WebKit

/// The bridge view controller, taught two things Capacitor's default does
/// not know about this app.
///
/// **The status bar follows Nox, not iOS.** `CAPBridgeViewController` leaves the
/// style at `.default`, which resolves against the *system* appearance. Nox has
/// its own theme switch, so a user running iOS in light mode with Nox set to
/// dark got black status bar glyphs on a black header — invisible. The web layer
/// already knows the effective theme; it posts it here and the bar follows.
///
/// **The window is never white before the web layer paints.** Launch, a return
/// from the background and an overscroll past the top all expose whatever is
/// behind the web view. Capacitor leaves that white, which is a flash on every
/// cold start in dark mode. Both the host view and the web view are painted the
/// theme's own background instead.
///
/// A third problem — the page scrolling itself to reveal a focused field,
/// leaving the composer stranded above the keyboard — used to be patched here
/// too, first by compensating for the scroll and then by disabling the page's
/// own scroll view outright. Neither held up on a physical device. The actual
/// fix is `interactive-widget: resizes-content` in the viewport meta
/// (`src/app/layout.tsx`): the layout viewport itself shrinks for the
/// keyboard, so there is nothing below the fold to reveal and nothing for a
/// native scroll lock to be defending against.
///
/// Deliberately no Capacitor plugin: this needs one message and one colour, and
/// a plugin would add a dependency, a registration list and a native build step
/// for that. Nothing here touches entitlements, so free Personal Team signing
/// keeps working.
class NoxViewController: CAPBridgeViewController, WKScriptMessageHandler {

    /// The channel name the web layer posts to. Kept in one place because the
    /// other end of it is a string literal in the page's boot script.
    private static let themeChannel = "noxTheme"

    /// Nil until the web layer reports in, so the first frames follow the system
    /// appearance rather than guessing.
    private var webTheme: String?

    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.configuration.userContentController.add(self, name: Self.themeChannel)

        // The web view draws its own page background; making it opaque-and-clear
        // here means the colour underneath shows during load and overscroll
        // instead of the default white.
        webView?.isOpaque = false
        webView?.backgroundColor = .clear
        webView?.scrollView.backgroundColor = .clear
        applyBackground()
    }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        // Only matters while the web layer has not reported a theme, or has
        // reported that it is following the system.
        if webTheme == nil || webTheme == "system" {
            applyBackground()
            setNeedsStatusBarAppearanceUpdate()
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        switch resolvedTheme() {
        case "dark":
            return .lightContent
        case "light":
            return .darkContent
        default:
            return .default
        }
    }

    // MARK: - WKScriptMessageHandler

    func userContentController(
        _ controller: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == Self.themeChannel else { return }
        guard let value = message.body as? String else { return }
        guard value == "dark" || value == "light" || value == "system" else { return }
        guard value != webTheme else { return }

        webTheme = value
        applyBackground()
        setNeedsStatusBarAppearanceUpdate()
    }

    // MARK: - Appearance

    private func resolvedTheme() -> String {
        if let theme = webTheme, theme != "system" { return theme }
        return traitCollection.userInterfaceStyle == .dark ? "dark" : "light"
    }

    /// The two values below are `--background` from the web theme. They are
    /// duplicated here on purpose: this colour has to exist before any web
    /// stylesheet has loaded, which is the whole point of setting it natively.
    private func applyBackground() {
        let dark = resolvedTheme() == "dark"
        let colour = dark
            ? UIColor(red: 0, green: 0, blue: 0, alpha: 1)
            : UIColor(red: 0xF2 / 255, green: 0xF2 / 255, blue: 0xF7 / 255, alpha: 1)
        view.backgroundColor = colour
        view.window?.backgroundColor = colour
    }
}
