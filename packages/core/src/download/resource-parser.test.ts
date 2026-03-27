import { describe, expect, it } from "vitest";

import {
  extractNavigationSections,
  extractResourceLinksFromHtml,
  extractSectionFolderName
} from "./resource-parser.js";

describe("resource-parser", () => {
  it("extracts week-style section folder names", () => {
    expect(
      extractSectionFolderName(
        "Week 3 - Path Planning",
        "https://learning.monash.edu/course/view.php?id=0002&section=15"
      )
    ).toBe("week_03");
  });

  it("extracts navigation sections from mst navigation", () => {
    const html = `
      <ul id="mst-navigation">
        <li class="hasdropdown">
          <ul class="second-level-nav">
            <li><a href="/course/view.php?id=0001&amp;section=8">Week 1 - Intro</a></li>
            <li><a href="/course/view.php?id=0001&amp;section=12">Week 2 - Search</a></li>
          </ul>
        </li>
      </ul>
    `;

    expect(
      extractNavigationSections(html, "https://learning.monash.edu").map((section) => ({
        title: section.title,
        url: section.url
      }))
    ).toEqual([
      {
        title: "Week 1 - Intro",
        url: "https://learning.monash.edu/course/view.php?id=0001&section=8"
      },
      {
        title: "Week 2 - Search",
        url: "https://learning.monash.edu/course/view.php?id=0001&section=12"
      }
    ]);
  });

  it("extracts downloadable resources from activity blocks", () => {
    const html = `
      <div class="course-content">
        <ul class="mst-level-1">
          <li class="section">
            <div class="course-section-header">
              <h3>Own-time</h3>
            </div>
            <div class="content">
              <ul class="section">
                <li class="activity modtype_label">
                  <div class="activity-altcontent">
                    <h3>Read Lecture Resources</h3>
                  </div>
                </li>
                <li class="activity modtype_resource" data-activityname="Lecture Slides">
                  <a href="/pluginfile.php/123/lecture.pdf">Lecture Slides File</a>
                </li>
                <li class="activity modtype_url" data-activityname="Wrap-up video">
                  <iframe src="https://monash.au.panopto.com/Panopto/Pages/Viewer.aspx?id=test-video"></iframe>
                </li>
              </ul>
            </div>
          </li>
        </ul>
      </div>
    `;

    expect(
      extractResourceLinksFromHtml(
        html,
        "https://learning.monash.edu/course/view.php?id=0002&section=15",
        "Week 3 - Path Planning"
      ).map((item) => ({
        subsection: item.subsection,
        group: item.group,
        title: item.title,
        resourceType: item.resourceType,
        delivery: item.delivery
      }))
    ).toEqual([
      {
        subsection: "Own-time",
        group: "Read Lecture Resources",
        title: "Lecture Slides File",
        resourceType: "file",
        delivery: "download"
      },
      {
        subsection: "Own-time",
        group: "Read Lecture Resources",
        title: "Wrap-up video",
        resourceType: "video",
        delivery: "reference"
      }
    ]);
  });
});
