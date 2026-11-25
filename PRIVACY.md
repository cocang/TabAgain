# TabAgain Privacy Policy

**Effective date:** 2026-11-25
**Last updated:** 2026-11-25

This Privacy Policy describes how the TabAgain browser extension ("TabAgain," "the extension," "we," or "us") handles information when you use it in Google Chrome, Microsoft Edge, Mozilla Firefox, or another compatible browser.

TabAgain is designed to work entirely on your device. We do not collect, receive, sell, or share your personal data or browsing information.

## 1. Scope

This policy applies to the TabAgain extension published by the developer of the [TabAgain repository](https://github.com/cocang/TabAgain). It does not apply to the websites you visit, or to the browser in which the extension is installed, each of which is governed by its own privacy policy.

## 2. Information Processed on Your Device

To provide its single purpose, which is reopening and managing tabs and windows you have closed, TabAgain processes the following information about your tabs:

- Page URLs and titles
- Website icons (favicons), as provided by the browser
- Window and tab identifiers, and each tab's position within its window
- Pinned state and tab group membership
- Browser session identifiers used to restore a tab with its navigation history
- The date and time each tab or window was closed

TabAgain also stores the settings you choose, such as the record limit, retention period, and websites to exclude.

This information is stored locally using the browser's IndexedDB and extension storage APIs. It is used solely to record, search, display, and restore closed tabs and windows, and for no other purpose.

## 3. Optional Mouse Gestures

Mouse gestures are turned off by default.

When you turn them on, TabAgain asks for optional permission to access websites. This permission is used only to run the gesture script on webpages so that it can recognize the gestures you draw.

The gesture script:

- Listens only to mouse movement and mouse button events, in order to recognize gestures
- Reads the address of the current page only to check it against your list of websites where gestures are not used
- Does not read or collect page text, form input, passwords, cookies, or any other webpage content

When you turn mouse gestures off, TabAgain unregisters the gesture script and gives up the optional website access permission.

## 4. Data Transmission and Sharing

TabAgain does not transmit your closed-tab records, URLs, page titles, or settings to us or to any third party. It contains no advertising, analytics, telemetry, or tracking code, does not require an account, and does not load or run remote code.

We do not sell, rent, share, or disclose user data to any third party for any purpose.

In Firefox, website icons are displayed from the icon address recorded by the browser. Displaying an icon may cause the browser to request it from the website that provides it, in the same way the browser does when you visit that website. TabAgain sends no other information with that request.

## 5. Data Retention and Deletion

Your records and settings remain on your device until you delete them or remove the extension. You control them at any time from within TabAgain, where you can:

- Delete individual records or several records at once
- Clear records by time range or by website
- Exclude specific websites from being recorded
- Set a maximum number of records and an automatic retention period

When you remove TabAgain from your browser, the browser deletes the data the extension stored locally.

## 6. Permissions

TabAgain requests only the permissions needed for its stated functionality:

| Permission | Purpose |
| --- | --- |
| `tabs` | Read the URL and title of tabs as they close, so they can be recorded and restored |
| `sessions` | Restore closed tabs and windows with their navigation history |
| `storage`, `unlimitedStorage` | Store settings and up to 99,999 records locally |
| `alarms` | Remove records past your retention period once a day |
| `favicon` | Display website icons (Chrome and Edge only) |
| `tabGroups` | Return restored tabs to their original tab group (Chrome and Edge only) |
| `scripting` | Register the gesture script after you turn on mouse gestures |
| Website access (optional) | Run the gesture script on webpages, requested only when you turn on mouse gestures |

## 7. Security

Because your data never leaves your device through TabAgain, its protection relies on the security of your device and browser profile. We recommend keeping your browser up to date and protecting your device with a password.

## 8. Children's Privacy

TabAgain does not knowingly collect any information from anyone, including children under the age of 13.

## 9. Changes to This Policy

We may update this Privacy Policy when TabAgain's functionality or data practices change. The updated policy will be published at this location with a new "Last updated" date. If a change materially affects how your information is handled, it will also be noted in the release notes for the corresponding version.

## 10. Contact

If you have questions or concerns about this Privacy Policy, please open an issue at:

https://github.com/cocang/TabAgain/issues
