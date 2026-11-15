# Third-party notices

Omafire is MIT licensed (see [LICENSE](LICENSE)). It includes or builds on the
following.

## omafox

Omafire grew out of [omafox](https://github.com/cover/omafox) by its
contributors, MIT licensed. The upstream copyright notice is kept in LICENSE.

## Layout ideas

The sidebar layout and compact column owe a lot to
[Zen Browser](https://zen-browser.app/) and
[parfait](https://github.com/reizumii/parfait), and the page-blur technique
under glass was learned from Zia. They are credited for the ideas; the theme is written
here.

## Artwork

The extension glyphs (`theme/src/icons/extensions/`) are monochrome marks
that identify other projects' add-ons in the toolbar. The marks belong to
their owners and are used only to name those add-ons; Omafire is not
affiliated with any of them.

- From [Simple Icons](https://simpleicons.org/) (CC0 1.0): 1Password, Steam
  (Augmented Steam), Dark Reader, Rakuten, Reddit (Reddit Enhancement Suite),
  uBlock Origin.
- Traced from the add-on's own icon, under that project's licence:
  SponsorBlock and DeArrow (GPL-3.0), Greasemonkey and Redirector (MIT),
  Bypass Paywalls Clean (its project states no licence).
- Multi-Account Containers: Mozilla's own glyph (MPL-2.0).
- Drawn for Omafire: Tether, Vimium C.

The new tab's shortcut editor can search Simple Icons for a brand icon; the
list and the marks are fetched from jsDelivr when you search, not bundled
(see [PRIVACY.md](PRIVACY.md#network)).

## Go (linked into the `omafire` binary)

The Go standard library, `golang.org/x/sys` and `golang.org/x/image`, all
BSD 3-Clause under this notice:

```text
Copyright 2009 The Go Authors.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of Google LLC nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
