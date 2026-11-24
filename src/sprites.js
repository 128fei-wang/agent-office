(function () {
  "use strict";

  const AO = window.AgentOffice;

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function mix(hex, target, amount) {
    const a = hex.replace("#", "");
    const b = target.replace("#", "");
    const out = [0, 2, 4].map(function (i) {
      const av = parseInt(a.slice(i, i + 2), 16);
      const bv = parseInt(b.slice(i, i + 2), 16);
      return Math.round(av + (bv - av) * amount)
        .toString(16)
        .padStart(2, "0");
    });
    return "#" + out.join("");
  }

  function spriteSVG(agent, size) {
    size = size || 38;
    const w = size;
    const h = Math.round(size * 17 / 14);
    const skin = agent.skin;
    const skinShade = mix(skin, "#000000", 0.18);
    const hair = agent.hair;
    const hairLight = mix(hair, "#ffffff", 0.16);
    const shirt = agent.shirt;
    const shirtLight = mix(shirt, "#ffffff", 0.18);
    const shirtDark = mix(shirt, "#000000", 0.28);
    const role = AO.ROLES[agent.role] || { color: shirt };
    const outline = "#111621";
    const pants = "#2b3444";

    const parts = [];
    function P(x, y, pw, ph, color, opacity) {
      parts.push(
        '<rect x="' + x + '" y="' + y + '" width="' + pw + '" height="' + ph +
        '" fill="' + color + '"' + (opacity != null ? ' opacity="' + opacity + '"' : "") + "/>"
      );
    }

    // long hair sits behind the body
    if (agent.hairStyle === "long") {
      P(2, 4, 1, 7, hair);
      P(11, 4, 1, 7, hair);
    }

    // shoes
    P(3, 15, 4, 1, "#10141c");
    P(7, 15, 4, 1, "#10141c");

    // legs
    P(3, 12, 8, 4, outline);
    P(4, 12, 2, 3, pants);
    P(8, 12, 2, 3, pants);

    // body
    P(2, 7, 10, 6, outline);
    P(3, 7, 8, 5, shirt);
    P(3, 11, 8, 1, shirtDark, 0.55);
    P(9, 7, 2, 4, shirtLight, 0.28);

    // arms
    P(1, 8, 2, 5, outline);
    P(11, 8, 2, 5, outline);
    P(2, 8, 1, 4, skin);
    P(11, 8, 1, 4, skin);
    P(2, 12, 1, 1, skinShade);
    P(11, 12, 1, 1, skinShade);

    // neck
    P(6, 6, 2, 1, skinShade);

    // head outline + skin
    P(2, 1, 10, 7, outline);
    P(3, 2, 8, 5, skin);
    P(2, 4, 1, 1, skinShade);
    P(11, 4, 1, 1, skinShade);

    // hair
    const hs = agent.hairStyle;
    if (hs === "short") {
      P(3, 0, 8, 2, hair);
      P(2, 1, 1, 3, hair);
      P(11, 1, 1, 3, hair);
      P(3, 2, 3, 1, hair);
      P(8, 2, 2, 1, hair);
      P(4, 0, 2, 1, hairLight);
    } else if (hs === "bob") {
      P(3, 0, 8, 2, hair);
      P(2, 1, 1, 6, hair);
      P(11, 1, 1, 6, hair);
      P(3, 2, 3, 1, hair);
      P(4, 0, 3, 1, hairLight);
    } else if (hs === "messy") {
      P(3, 0, 8, 1, hair);
      P(3, 1, 2, 1, hair);
      P(5, 1, 1, 1, hair);
      P(7, 1, 2, 1, hair);
      P(9, 1, 2, 1, hair);
      P(2, 1, 1, 3, hair);
      P(11, 1, 1, 3, hair);
      P(4, 0, 2, 1, hairLight);
      P(8, 0, 1, 1, hairLight);
    } else if (hs === "curly") {
      P(3, 0, 8, 2, hair);
      P(2, 1, 1, 3, hair);
      P(11, 1, 1, 3, hair);
      P(4, 0, 2, 1, hair);
      P(8, 0, 2, 1, hair);
      P(3, 2, 2, 1, hair);
      P(9, 2, 2, 1, hair);
      P(5, 0, 1, 1, hairLight);
    } else if (hs === "long") {
      P(3, 0, 8, 2, hair);
      P(2, 1, 1, 6, hair);
      P(11, 1, 1, 6, hair);
      P(3, 2, 3, 1, hair);
      P(8, 2, 2, 1, hair);
      P(4, 0, 3, 1, hairLight);
    } else if (hs === "ponytail") {
      P(3, 0, 8, 2, hair);
      P(2, 1, 1, 3, hair);
      P(3, 2, 3, 1, hair);
      P(11, 1, 2, 3, hair);
      P(13, 2, 1, 2, hair);
      P(11, 3, 1, 1, role.color);
      P(4, 0, 3, 1, hairLight);
    }

    // face
    P(4, 4, 1, 1, "#1b2430");
    P(8, 4, 1, 1, "#1b2430");
    P(4, 3, 1, 1, hair);
    P(8, 3, 1, 1, hair);
    P(6, 6, 2, 1, mix(skin, "#9c4a44", 0.6));

    // accessories
    if (agent.accessory === "tie") {
      P(6, 7, 2, 3, "#202838");
      P(6, 9, 2, 1, role.color);
    } else if (agent.accessory === "scarf") {
      P(3, 7, 8, 1, "#f7d8e4");
      P(3, 8, 1, 1, "#f7d8e4");
    } else if (agent.accessory === "headphones") {
      P(3, 0, 8, 1, "#151b26");
      P(1, 3, 2, 3, "#151b26");
      P(11, 3, 2, 3, "#151b26");
      P(1, 4, 1, 1, role.color);
      P(12, 4, 1, 1, role.color);
    } else if (agent.accessory === "glasses") {
      P(3, 3, 3, 2, "#1b2430");
      P(8, 3, 3, 2, "#1b2430");
      P(6, 3, 2, 1, "#1b2430");
      P(4, 4, 1, 1, "#bfe8ff");
      P(9, 4, 1, 1, "#bfe8ff");
    } else if (agent.accessory === "cap") {
      P(4, 0, 6, 2, shirtDark);
      P(2, 2, 10, 1, shirtDark);
      P(5, 0, 3, 1, shirtLight);
    }

    return (
      '<svg class="pixel-sprite" width="' + w + '" height="' + h +
      '" viewBox="0 0 14 17" shape-rendering="crispEdges" aria-hidden="true">' +
      parts.join("") +
      "</svg>"
    );
  }

  AO.spriteSVG = spriteSVG;
  AO.mixColor = mix;
})();
