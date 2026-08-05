import discord
from discord.ext import commands
import os

bot = commands.Bot(command_prefix="!", intents=discord.Intents.default())

@bot.event
async def on_ready():
    print(f"Logged in as {bot.user}")

@bot.listen('on_interaction')
async def my_interaction_handler(interaction):
    print("INTERACTION RECEIVED:", interaction.data)

bot.run(os.getenv("DISCORD_TOKEN"))
