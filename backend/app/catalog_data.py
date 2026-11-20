from functools import lru_cache
from pathlib import Path


EQUIPMENT_CATALOG = (
    ("echovibe-karaoke-rentals", "Professional Karaoke System", "Karaoke Machines", 450_000, 2),
    ("echovibe-karaoke-rentals", "Portable Karaoke Tablet Controller", "Karaoke Machines", 120_000, 2),
    ("echovibe-karaoke-rentals", "Active PA Speaker", "Speakers & Sound Systems", 250_000, 3),
    ("echovibe-karaoke-rentals", "Wireless Microphone", "Microphones", 90_000, 4),
    ("echovibe-karaoke-rentals", "Audio Mixer", "Audio Equipment", 180_000, 2),
    ("echovibe-karaoke-rentals", "Smart TV", "Displays", 300_000, 2),
    ("echovibe-karaoke-rentals", "Moving Head Light", "Lighting & Effects", 220_000, 2),
    ("echovibe-karaoke-rentals", "Adjustable Speaker Stand", "Accessories", 50_000, 4),
    ("echovibe-karaoke-rentals", "HDMI Cable", "Accessories", 5_000, 6),
    ("echovibe-karaoke-rentals", "Equipment Case", "Accessories", 35_000, 3),
    ("micdrop-karaoke-hub", "Portable Karaoke Machine", "Karaoke Machines", 180_000, 3),
    ("micdrop-karaoke-hub", "Portable Bluetooth Speaker", "Speakers & Sound Systems", 85_000, 4),
    ("micdrop-karaoke-hub", "Dual Wireless Microphone Set", "Microphones", 120_000, 3),
    ("micdrop-karaoke-hub", "Digital Audio Mixer", "Audio Equipment", 250_000, 2),
    ("micdrop-karaoke-hub", "LED Television", "Displays", 260_000, 2),
    ("micdrop-karaoke-hub", "LED Party Light", "Lighting & Effects", 45_000, 5),
    ("micdrop-karaoke-hub", "Lighting Stand", "Lighting & Effects", 65_000, 3),
    ("micdrop-karaoke-hub", "Audio Cable", "Accessories", 8_000, 8),
    ("micdrop-karaoke-hub", "Speaker Cover", "Accessories", 18_000, 4),
    ("micdrop-karaoke-hub", "Portable Power Station", "Accessories", 320_000, 2),
    ("soundwave-rentals", "Touchscreen Karaoke Player", "Karaoke Machines", 380_000, 2),
    ("soundwave-rentals", "Passive PA Speaker", "Speakers & Sound Systems", 150_000, 4),
    ("soundwave-rentals", "Professional Vocal Microphone", "Microphones", 110_000, 4),
    ("soundwave-rentals", "Audio Processor", "Audio Equipment", 175_000, 2),
    ("soundwave-rentals", "Projector", "Displays", 280_000, 2),
    ("soundwave-rentals", "LED Par Light", "Lighting & Effects", 55_000, 6),
    ("soundwave-rentals", "Microphone Stand", "Microphones", 25_000, 5),
    ("soundwave-rentals", "Extension Cord", "Accessories", 12_000, 6),
    ("soundwave-rentals", "Multi-Channel Wireless Microphone System", "Microphones", 240_000, 2),
    ("soundwave-rentals", "Wired Microphone", "Microphones", 35_000, 6),
    ("partypulse-karaoke", "Home Karaoke System", "Karaoke Machines", 160_000, 3),
    ("partypulse-karaoke", "Commercial Karaoke Machine", "Karaoke Machines", 420_000, 2),
    ("partypulse-karaoke", "Subwoofer", "Speakers & Sound Systems", 220_000, 2),
    ("partypulse-karaoke", "Microphone Receiver", "Microphones", 75_000, 3),
    ("partypulse-karaoke", "Equalizer", "Audio Equipment", 95_000, 2),
    ("partypulse-karaoke", "Projection Screen", "Displays", 85_000, 2),
    ("partypulse-karaoke", "Disco Light", "Lighting & Effects", 55_000, 4),
    ("partypulse-karaoke", "Laser Light", "Lighting & Effects", 70_000, 2),
    ("partypulse-karaoke", "Power Strip", "Accessories", 8_000, 6),
    ("partypulse-karaoke", "Speaker Stand", "Accessories", 35_000, 4),
    ("encorebeat-rentals", "Smart Karaoke Console", "Karaoke Machines", 350_000, 2),
    ("encorebeat-rentals", "Professional Loudspeaker", "Speakers & Sound Systems", 280_000, 3),
    ("encorebeat-rentals", "Column Speaker", "Speakers & Sound Systems", 320_000, 2),
    ("encorebeat-rentals", "Amplifier", "Audio Equipment", 190_000, 2),
    ("encorebeat-rentals", "Monitor Speaker", "Speakers & Sound Systems", 125_000, 3),
    ("encorebeat-rentals", "Audio Interface", "Audio Equipment", 90_000, 2),
    ("encorebeat-rentals", "DI Box", "Audio Equipment", 25_000, 4),
    ("encorebeat-rentals", "Smart TV Karaoke Monitor", "Displays", 200_000, 2),
    ("encorebeat-rentals", "Touchscreen Display", "Displays", 240_000, 2),
    ("encorebeat-rentals", "Fog Machine", "Lighting & Effects", 100_000, 2),
)

PACKAGE_CATALOG = (
    (
        "echovibe-karaoke-rentals",
        "Basic Karaoke Package",
        "Karaoke Packages",
        "A simple karaoke setup for small gatherings, with a karaoke controller, powered speaker, and wireless microphone.",
        350_000,
        ("Portable Karaoke Tablet Controller", "Active PA Speaker", "Wireless Microphone"),
    ),
    (
        "echovibe-karaoke-rentals",
        "Standard Karaoke Package",
        "Karaoke Packages",
        "A complete home party setup with a professional karaoke system, display, and two microphones.",
        650_000,
        ("Professional Karaoke System", "Smart TV", "Wireless Microphone"),
    ),
    (
        "echovibe-karaoke-rentals",
        "Premium Karaoke Package",
        "Karaoke Packages",
        "A higher-output karaoke setup with a mixer, powered speakers, microphones, and party lighting.",
        900_000,
        ("Professional Karaoke System", "Audio Mixer", "Active PA Speaker", "Moving Head Light"),
    ),
    (
        "echovibe-karaoke-rentals",
        "Professional Karaoke Package",
        "Karaoke Packages",
        "A flexible performance setup for hosts who need a mixer, a full-range PA speaker, and vocal microphones.",
        1_200_000,
        ("Professional Karaoke System", "Audio Mixer", "Active PA Speaker", "Wireless Microphone"),
    ),
    (
        "micdrop-karaoke-hub",
        "Home Karaoke Package",
        "Home & Family Packages",
        "A compact home setup with a karaoke machine, portable speaker, display, and dual wireless microphones.",
        500_000,
        ("Portable Karaoke Machine", "Portable Bluetooth Speaker", "LED Television", "Dual Wireless Microphone Set"),
    ),
    (
        "micdrop-karaoke-hub",
        "Family Party Package",
        "Home & Family Packages",
        "A family-friendly karaoke bundle with a portable sound system and a dual microphone set.",
        420_000,
        ("Portable Karaoke Machine", "Portable Bluetooth Speaker", "Dual Wireless Microphone Set"),
    ),
    (
        "micdrop-karaoke-hub",
        "Birthday Party Package",
        "Party Packages",
        "A birthday-ready karaoke bundle with sound, microphones, and colorful LED party lighting.",
        520_000,
        ("Portable Karaoke Machine", "Portable Bluetooth Speaker", "Dual Wireless Microphone Set", "LED Party Light"),
    ),
    (
        "micdrop-karaoke-hub",
        "Outdoor Karaoke Package",
        "Party Packages",
        "A portable outdoor setup with a power station, karaoke sound, and wireless microphones.",
        580_000,
        ("Portable Karaoke Machine", "Portable Bluetooth Speaker", "Dual Wireless Microphone Set", "Portable Power Station"),
    ),
    (
        "soundwave-rentals",
        "Small Event Sound Package",
        "Event Sound Packages",
        "A compact event PA bundle with a speaker, processor, vocal microphone, and basic stand.",
        450_000,
        ("Passive PA Speaker", "Audio Processor", "Professional Vocal Microphone", "Microphone Stand"),
    ),
    (
        "soundwave-rentals",
        "Medium Event Sound Package",
        "Event Sound Packages",
        "A versatile sound setup for medium gatherings with a projector and wireless microphone options.",
        780_000,
        ("Touchscreen Karaoke Player", "Passive PA Speaker", "Projector", "Multi-Channel Wireless Microphone System"),
    ),
    (
        "soundwave-rentals",
        "Large Event Sound Package",
        "Event Sound Packages",
        "An expanded PA and microphone bundle for larger school, community, or company events.",
        1_250_000,
        ("Touchscreen Karaoke Player", "Passive PA Speaker", "Multi-Channel Wireless Microphone System", "LED Par Light"),
    ),
    (
        "soundwave-rentals",
        "DJ Sound Package",
        "Event Sound Packages",
        "A performance-oriented sound bundle with a PA speaker, audio processing, microphones, and stage lighting.",
        1_050_000,
        ("Passive PA Speaker", "Audio Processor", "Professional Vocal Microphone", "LED Par Light"),
    ),
    (
        "partypulse-karaoke",
        "Complete Party Package",
        "Party Packages",
        "A full karaoke party setup with a commercial player, subwoofer, microphones, screen, and lighting.",
        1_150_000,
        ("Commercial Karaoke Machine", "Subwoofer", "Microphone Receiver", "Projection Screen", "Disco Light"),
    ),
    (
        "partypulse-karaoke",
        "Wedding Entertainment Package",
        "Event Sound Packages",
        "A polished reception bundle combining commercial karaoke, projection, low-end sound, and lighting effects.",
        1_650_000,
        ("Commercial Karaoke Machine", "Subwoofer", "Microphone Receiver", "Projection Screen", "Laser Light"),
    ),
    (
        "partypulse-karaoke",
        "Corporate Event Package",
        "Event Sound Packages",
        "A professional presentation and entertainment setup with a karaoke system, screen, and PA support.",
        1_400_000,
        ("Commercial Karaoke Machine", "Subwoofer", "Equalizer", "Projection Screen", "Speaker Stand"),
    ),
    (
        "encorebeat-rentals",
        "School Event Package",
        "Event Sound Packages",
        "A flexible school event bundle with karaoke, loudspeakers, microphones, and monitor equipment.",
        1_050_000,
        ("Smart Karaoke Console", "Professional Loudspeaker", "Monitor Speaker", "DI Box"),
    ),
    (
        "encorebeat-rentals",
        "LED Party Package",
        "Party Packages",
        "A stage-focused party setup with a karaoke console, loudspeakers, display, and fog effects.",
        1_250_000,
        ("Smart Karaoke Console", "Professional Loudspeaker", "Smart TV Karaoke Monitor", "Fog Machine"),
    ),
    (
        "encorebeat-rentals",
        "Complete Audio and Lighting Package",
        "Event Sound Packages",
        "A complete sound and lighting bundle with speaker systems, interface equipment, display, and atmospheric effects.",
        1_850_000,
        ("Smart Karaoke Console", "Professional Loudspeaker", "Column Speaker", "Amplifier", "Fog Machine"),
    ),
)

CATEGORY_IMAGES = {
    "Karaoke Machines": "/assets/catalog/karaoke.svg",
    "Speakers & Sound Systems": "/assets/catalog/speakers.svg",
    "Microphones": "/assets/catalog/microphones.svg",
    "Audio Equipment": "/assets/catalog/audio.svg",
    "Displays": "/assets/catalog/displays.svg",
    "Lighting & Effects": "/assets/catalog/lighting.svg",
    "Accessories": "/assets/catalog/accessories.svg",
}

PACKAGE_IMAGE = "/assets/catalog/packages.svg"


@lru_cache
def catalog_image_bytes(image_url: str) -> bytes:
    filename = image_url.rsplit("/", 1)[-1]
    if not filename.endswith(".svg") or "/" in filename or "\\" in filename:
        raise ValueError("Catalog images must use a supported local SVG asset.")
    image_path = Path(__file__).resolve().parents[2] / "src" / "assets" / "catalog" / filename
    return image_path.read_bytes()


def equipment_description(name: str, category: str) -> str:
    use_case = {
        "Karaoke Machines": "home karaoke, birthday parties, and community gatherings",
        "Speakers & Sound Systems": "clear event audio for indoor celebrations and presentations",
        "Microphones": "speeches, hosting, and karaoke performances",
        "Audio Equipment": "mixing and shaping audio for karaoke or live events",
        "Displays": "lyrics, presentations, and event visuals",
        "Lighting & Effects": "adding atmosphere to parties and stage events",
        "Accessories": "supporting safe and organized event equipment setup",
    }[category]
    return f"Rent the {name.lower()} for {use_case}. Choose your rental dates to check availability."


def equipment_specifications(name: str, category: str) -> dict[str, str]:
    specifications = {
        "Equipment type": name,
        "Rental setup": "Includes the main unit and its standard power connection.",
    }
    if category == "Karaoke Machines":
        specifications["Typical connections"] = "HDMI video and RCA or 3.5 mm audio output"
    elif category == "Speakers & Sound Systems":
        specifications["Typical connections"] = "XLR or 1/4-inch audio input"
    elif category == "Microphones":
        specifications["Setup"] = "Microphone and compatible cable or receiver, as applicable"
    elif category == "Audio Equipment":
        specifications["Setup"] = "Audio signal processing or mixing equipment"
    elif category == "Displays":
        specifications["Typical connection"] = "HDMI input"
    elif category == "Lighting & Effects":
        specifications["Setup"] = "Indoor event effect; placement and power requirements vary by unit"
    else:
        specifications["Use"] = "Karaoke and event equipment accessory"
    return specifications
