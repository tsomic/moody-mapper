import type {
  AbstractedLink,
  AbstractedRectangleImage,
} from "@/constants/interfaces/AbstractedElements";
import { useDiagramStore } from "@/stores/diagram";
import { useFacesStore } from "@/stores/faces";
import { storeToRefs } from "pinia";

export const useMapping = () => {
  const { faces } = storeToRefs(useFacesStore());
  const { graphConfig } = storeToRefs(useDiagramStore());

  const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise(function (resolve, reject) {
      const img = new Image();

      img.onload = function () {
        resolve(img);
      };

      img.onerror = function () {
        reject(new Error("Failed to load image: " + src));
      };

      img.src = src;
    });
  };

  const generateArduinoFaces = async () => {
    const canvas = new OffscreenCanvas(32, 16);
    const ctx = canvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!ctx) throw new Error();

    const faceKeys = faces.value.map((face) => face.name).sort();

    const outputData = [];

    for (let i = 0; i < faceKeys.length; i++) {
      const face =
        faces.value.find((item) => item.name === faceKeys[i])?.images || [];

      const faceData = [];
      for (let j = 0; j < face.length; j++) {
        const img = await loadImage(face[j]);

        ctx.drawImage(img, 0, 0);
        const pixelData = ctx.getImageData(
          0,
          0,
          canvas.width,
          canvas.height
        ).data;

        const binaryStrings = generateBinaryStrings(pixelData);

        faceData.push(`{${binaryStrings.join(", ")}}`);
      }

      let facesString = faceData.map((item) => `    ${item}`).join(",\n");
      facesString = ["  {", facesString, "  }"].join("\n");

      outputData.push(facesString);
    }

    const outputString = [
      "static const byte allFaces[][2][64] PROGMEM = {",
      outputData.join(",\n"),
      "};\n",
    ].join("\n");

    return outputString;
  };

  const generateBinaryStrings = (pixelData: Uint8ClampedArray) => {
    const redChannelData = Array.from(pixelData, (_, i) => pixelData[i * 4])
      .filter((val) => val !== undefined)
      .map((val) => (val ? 0 : 1));

    const binaryStrings = [];

    for (let i = 0; i < redChannelData.length; i += 8) {
      const slice = redChannelData.slice(i, i + 8);
      const binaryString = `0b${slice.join("")}`;
      binaryStrings.push(binaryString);
    }

    return binaryStrings;
  };

  const generateConfigFile = () => {
    const mappings = generateMappings();
    const maxLinks = getMaxLinks(mappings);
    const fileMappings = generateFileMappings(mappings, maxLinks);

    return `#define NUMBER_FACES ${faces.value.length}
#define INVALID_FACE -1
${generateDefines()}\n
const int8_t nextFaces[][${maxLinks}] = {
${fileMappings}};\n`;
  };

  const generateDefines = () => {
    return faces.value
      .map((face, index) => `#define ${face.name.toUpperCase()} ${index}`)
      .join("\n");
  };

  const getMaxLinks = (mappings: Record<string, string[]>) => {
    return Object.values(mappings).reduce(
      (acc, cur) => Math.max(acc, cur.length),
      0
    );
  };

  const getElementNameById = (id: string) => {
    return (
      graphConfig.value.cells.find(
        (cell) => cell.id === id
      ) as AbstractedRectangleImage
    ).name;
  };

  const generateMappings = () => {
    const mappings = {};

    (
      graphConfig.value.cells.filter(
        (cell) => cell.type === "standard.Link"
      ) as AbstractedLink[]
    ).forEach((link) => {
      const from = getElementNameById(link.source.id);
      const to = getElementNameById(link.target.id);

      const target = faces.value.find((face) => face.name === to)?.name;
      if (!target) return;

      addMapping(mappings, from, target);
    });

    return mappings;
  };

  const addMapping = (
    map: Record<string, string[]>,
    face: string,
    target: string
  ) => {
    if (!map[face]) map[face] = [];
    map[face].push(target.toUpperCase());
  };

  const generateFileMappings = (
    mappings: Record<string, string[]>,
    max: number
  ) => {
    const fullMappings: Record<string, string[]> = {};

    Object.keys(mappings).forEach((key) => {
      fullMappings[key] = mappings[key]
        .sort()
        .concat(Array(max - mappings[key].length).fill("INVALID_FACE"));
    });

    let fileMappings = "";

    faces.value.forEach((face, index) => {
      if (!fullMappings[face.name]) {
        fullMappings[face.name] = Array(max).fill("INVALID_FACE");
      }
      fileMappings += `  {${fullMappings[face.name].join(", ")}}`;
      if (index !== faces.value.length - 1) fileMappings += ",";
      fileMappings += ` //${face.name.toUpperCase()}\n`;
    });

    return fileMappings;
  };

  return {
    generateConfigFile,
    generateArduinoFaces,
  };
};
