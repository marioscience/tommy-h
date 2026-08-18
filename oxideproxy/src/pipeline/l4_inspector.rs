use nom::{bytes::complete::take, number::complete::be_u16, IResult};

#[derive(Debug, PartialEq, Eq)]
pub struct GamePacket<'a> {
    pub game_id: u16,
    pub payload_len: u16,
    pub payload: &'a [u8], // Zero-Copy slice apuntando directamente al BytesMut original
}

pub fn parse_game_packet(input: &[u8]) -> IResult<&[u8], GamePacket<'_>> {
    let (input, game_id) = be_u16(input)?;
    let (input, payload_len) = be_u16(input)?;
    let (input, payload) = take(payload_len)(input)?;

    Ok((
        input,
        GamePacket {
            game_id,
            payload_len,
            payload,
        },
    ))
}
